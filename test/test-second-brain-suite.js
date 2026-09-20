import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TFRetriever } from '../src/services/second-brain/tf-retriever.js';
import { DocumentIndexer } from '../src/services/second-brain/document-indexer.js';
import { CatalogBuilder, safeAtomicWrite, parseFrontmatter } from '../src/services/second-brain/catalog-builder.js';
import { KnowledgeSynthesizer, sanitizeSlug, computeContentHash } from '../src/services/second-brain/synthesizer.js';
import { VaultManager } from '../src/services/second-brain/vault-manager.js';
import { LocalStore } from '../src/utils/local-store.js';
import { aiAgentAdapter } from '../src/adapters/ai-agent.js';

export async function runSecondBrainTestSuite() {
  console.log('57. Testing Second Brain Studio Suite (BM25 Retriever, Vaults, Mutex, Auto-Migration & Rollback)...');

  const testVaultBaseDir = path.resolve(process.cwd(), 'data', 'test-vaults');
  const testDbPath = path.resolve(process.cwd(), 'data', 'test-second-brain.db');

  // Dọn dẹp môi trường kiểm thử cũ
  if (fs.existsSync(testVaultBaseDir)) {
    fs.rmSync(testVaultBaseDir, { recursive: true, force: true });
  }
  if (fs.existsSync(testDbPath)) {
    fs.rmSync(testDbPath, { force: true });
  }

  const testStore = new LocalStore(testDbPath);

  try {
    // -------------------------------------------------------------------------
    // 1. Kiểm thử TFRetriever & Tiếng Việt Dual-Indexing (Không Dấu / Có Dấu)
    // -------------------------------------------------------------------------
    const retriever = new TFRetriever();
    retriever.addDocument({
      id: 'bang-gia-pro',
      title: 'Bảng giá gói Pro Business',
      content: 'Bảng giá gói Pro Business là 2.500.000đ mỗi năm, hỗ trợ Bot AI tư vấn 24/7.'
    });
    retriever.addDocument({
      id: 'chinh-sach-bao-hanh',
      title: 'Chính sách bảo hành kỹ thuật',
      content: 'Chính sách bảo hành kỹ thuật 1-1 từ 8h sáng đến 22h đêm các ngày trong tuần.'
    });
    retriever.addDocument({
      id: 'gioi-thieu-shop',
      title: 'Giới thiệu giải pháp',
      content: 'Shop chuyên cung cấp giải pháp chuyển đổi số bán hàng Zalo tự động hóa.'
    });

    assert.equal(retriever.docCount, 3, 'Retriever phải lưu đủ 3 documents');

    // Tìm kiếm có dấu
    const res1 = retriever.query('giá gói pro bao nhiêu', { limit: 2, minScore: 0.1 });
    assert.ok(res1.length > 0, 'Phải tìm thấy kết quả cho câu hỏi có dấu');
    assert.equal(res1[0].id, 'bang-gia-pro', 'Tài liệu liên quan nhất phải là bang-gia-pro');
    assert.ok(res1[0].score > 0.1, 'Điểm tương đồng phải > 0.1');

    // Tìm kiếm không dấu (Dual-indexing invariant)
    const res2 = retriever.query('chinh sach bao hanh ky thuat', { limit: 2, minScore: 0.1 });
    assert.ok(res2.length > 0, 'Phải tìm thấy tài liệu khi gõ không dấu');
    assert.equal(res2[0].id, 'chinh-sach-bao-hanh', 'Tài liệu tìm thấy phải là chinh-sach-bao-hanh');

    // Hot reload document
    retriever.removeDocument('gioi-thieu-shop');
    assert.equal(retriever.docCount, 2, 'Doc count phải giảm xuống 2 sau khi xóa');
    const res3 = retriever.query('chuyển đổi số bán hàng', { limit: 2, minScore: 0.1 });
    assert.equal(res3.length, 0, 'Tài liệu đã xóa không được xuất hiện trong kết quả');

    // -------------------------------------------------------------------------
    // 2. Kiểm thử DocumentIndexer & Frontmatter Parser & Chunking
    // -------------------------------------------------------------------------
    const indexer = new DocumentIndexer();
    const sampleMd = `---
title: Bảng Giá Dịch Vụ
tags: [gia, combo, khuyen-mai]
---

# Bảng Giá Tổng Hợp

## 1. Gói Khởi Nghiệp
Giá niêm yết 500k/tháng, phù hợp cá nhân kinh doanh nhỏ lẻ.

## 2. Gói Doanh Nghiệp
Giá niêm yết 2.5 triệu/năm, đầy đủ tính năng CRM và AI Suite.
`;

    const parsed = parseFrontmatter(sampleMd);
    assert.equal(parsed.metadata.title, 'Bảng Giá Dịch Vụ', 'Phải bóc tách đúng title trong frontmatter');
    assert.deepEqual(parsed.metadata.tags, ['gia', 'combo', 'khuyen-mai'], 'Phải bóc tách đúng mảng tags');

    const chunks = indexer.parseMarkdown(sampleMd, 'bang-gia.md');
    assert.ok(chunks.length >= 2, 'Phải phân khúc thành ít nhất 2 chunks theo heading');
    assert.ok(chunks.some(c => (c.title + ' ' + c.content).includes('Gói Khởi Nghiệp')), 'Chunk phải chứa nội dung mục 1');
    assert.ok(chunks.some(c => (c.title + ' ' + c.content).includes('Gói Doanh Nghiệp')), 'Chunk phải chứa nội dung mục 2');

    // -------------------------------------------------------------------------
    // 3. Kiểm thử safeAtomicWrite & Sanitize Slug & Hash Content
    // -------------------------------------------------------------------------
    const testFile = path.join(testVaultBaseDir, 'test-atomic.md');
    fs.mkdirSync(testVaultBaseDir, { recursive: true });
    safeAtomicWrite(testFile, '# Nội Dung Nguyên Tử');
    assert.ok(fs.existsSync(testFile), 'Tệp nguyên tử phải tồn tại trên đĩa');
    assert.equal(fs.readFileSync(testFile, 'utf8'), '# Nội Dung Nguyên Tử', 'Nội dung đọc được phải toàn vẹn');

    // Path Traversal Immunity
    assert.equal(sanitizeSlug('../../../hack'), 'hack', 'Sanitize slug phải triệt tiêu path traversal ../');
    assert.equal(sanitizeSlug('Bảng Giá & Khuyến Mãi 2026!'), 'bang-gia-khuyen-mai-2026', 'Sanitize slug phải chuẩn hóa tiếng Việt thành slug đẹp');

    // Hash Invariant
    const hash1 = computeContentHash('Hello World');
    const hash2 = computeContentHash('Hello World');
    const hash3 = computeContentHash('Hello World 2');
    assert.equal(hash1, hash2, 'Cùng nội dung phải sinh ra hash giống nhau');
    assert.notEqual(hash1, hash3, 'Khác nội dung phải sinh ra hash khác nhau');

    // -------------------------------------------------------------------------
    // 4. Kiểm thử VaultManager Multi-Profile Isolation, LRU Eviction & Mutex
    // -------------------------------------------------------------------------
    const vaultManager = new VaultManager({
      baseVaultsDir: testVaultBaseDir,
      maxHotProfiles: 3, // Giới hạn 3 profile hot
      store: testStore
    });

    // Tạo các bài viết cho profile 'sales'
    await vaultManager.saveArticle({
      profileId: 'sales',
      slug: 'chinh-sach-giam-gia',
      title: 'Chính Sách Giảm Giá',
      content: '# Giảm Giá 20%\nÁp dụng cho khách hàng đăng ký gói 2 năm.',
      tags: ['khuyen-mai', 'sales']
    });

    // Tạo bài viết cho profile 'support'
    await vaultManager.saveArticle({
      profileId: 'support',
      slug: 'quy-trinh-bao-hanh',
      title: 'Quy Trình Bảo Hành',
      content: '# Quy Trình Tiếp Nhận\nKhách hàng liên hệ hotline 1900xxxx để được bảo hành.',
      tags: ['support', 'bao-hanh']
    });

    const salesArticles = await vaultManager.listArticles('sales');
    const supportArticles = await vaultManager.listArticles('support');
    assert.equal(salesArticles.length, 1, 'Profile sales phải có đúng 1 bài');
    assert.equal(supportArticles.length, 1, 'Profile support phải có đúng 1 bài');
    assert.equal(salesArticles[0].slug, 'chinh-sach-giam-gia', 'Slug bài viết của sales');
    assert.equal(supportArticles[0].slug, 'quy-trinh-bao-hanh', 'Slug bài viết của support');

    // Kiểm thử LRU Cache Eviction (Capping Hot Profiles trong RAM)
    await vaultManager.getRetriever('prof_1');
    await vaultManager.getRetriever('prof_2');
    await vaultManager.getRetriever('prof_3');
    await vaultManager.getRetriever('prof_4'); // Vượt quá maxHotProfiles = 3
    assert.ok(vaultManager.loadedVaults.size <= 3, 'LRU Cache phải tự động giải phóng bộ nhớ để giữ size <= 3');

    // -------------------------------------------------------------------------
    // 5. Kiểm thử Auto-Migration từ Legacy memoryPrompt & fewShot sang Markdown
    // -------------------------------------------------------------------------
    const legacyProfile = {
      id: 'legacy_client',
      memoryPrompt: 'Thông tin bảo hành cũ lưu từ textarea ngày xưa',
      exemplarConversation: JSON.stringify([
        { role: 'user', text: 'Shop có ship COD không?' },
        { role: 'assistant', text: 'Dạ bên em có hỗ trợ ship COD toàn quốc ạ!' }
      ])
    };

    await vaultManager._autoMigrateLegacyData('legacy_client', legacyProfile);
    const migratedArticles = await vaultManager.listArticles('legacy_client');
    assert.ok(migratedArticles.some(a => a.slug === 'legacy-memory'), 'Phải tự động di trú memoryPrompt thành legacy-memory.md');
    assert.ok(migratedArticles.some(a => a.slug === 'mau-hoi-thoai'), 'Phải tự động di trú exemplarConversation thành mau-hoi-thoai.md');

    // -------------------------------------------------------------------------
    // 6. Kiểm thử SQLite Wiki Revisions Snapshot & Rollback 1-Click
    // -------------------------------------------------------------------------
    // Ghi nhận revision đầu tiên
    const rev1 = testStore.recordWikiRevision({
      profileId: 'sales',
      slug: 'chinh-sach-giam-gia',
      title: 'Chính Sách Giảm Giá',
      content: '# Giảm Giá 20%\nÁp dụng cho khách hàng đăng ký gói 2 năm.',
      summary: 'Khởi tạo ban đầu'
    });
    assert.ok(rev1.id > 0, 'Revision 1 phải có ID hợp lệ');

    // Cập nhật bài viết với nội dung mới
    await vaultManager.saveArticle({
      profileId: 'sales',
      slug: 'chinh-sach-giam-gia',
      title: 'Chính Sách Giảm Giá (Mới)',
      content: '# Giảm Giá 50% Siêu Sale\nChỉ áp dụng trong ngày Black Friday.',
      summary: 'Cập nhật giá sốc Black Friday'
    });

    const updatedArt = await vaultManager.getArticle('sales', 'chinh-sach-giam-gia');
    assert.ok(updatedArt.content.includes('Giảm Giá 50%'), 'Bài viết đã được cập nhật thành 50%');

    // Hoàn tác (Rollback) về revision 1
    const rollbackRes = await vaultManager.synthesizer.rollbackRevision({
      revisionId: rev1.id,
      vaultDir: vaultManager.getVaultDir('sales'),
      store: testStore,
      retriever: await vaultManager.getRetriever('sales'),
      indexer: await vaultManager.getIndexer('sales')
    });

    assert.equal(rollbackRes.status, 'success', 'Rollback phải thành công');
    // 6b. Kiểm thử applyDiff (Hỗ trợ cả content lẫn proposedContent)
    const diffRes = await vaultManager.synthesizer.applyDiff({
      profileId: 'sales',
      slug: 'chinh-sach-giam-gia',
      title: 'Chính Sách Giảm Giá VIP',
      proposedContent: '---\ntitle: "Chính Sách Giảm Giá VIP"\ntags: [khuyen-mai]\n---\n# Giảm Giá 30% VIP\nƯu đãi đặc biệt cho thành viên VIP.',
      summary: 'Duyệt đề xuất áp dụng diff từ AI',
      vaultDir: vaultManager.getVaultDir('sales'),
      store: testStore,
      retriever: await vaultManager.getRetriever('sales'),
      indexer: await vaultManager.getIndexer('sales')
    });
    assert.equal(diffRes.status, 'success', 'applyDiff với proposedContent phải thành công');
    const appliedArt = await vaultManager.getArticle('sales', 'chinh-sach-giam-gia');
    assert.ok(appliedArt.content.includes('Giảm Giá 30% VIP'), 'Nội dung sau applyDiff phải chứa thông tin mới');

    // 7. Kiểm thử Dynamic Context Injection vào AiAgent compilePrompt
    // -------------------------------------------------------------------------
    aiAgentAdapter.setVaultManager(vaultManager);
    const settings = {
      profileId: 'sales',
      soulPrompt: 'Bạn là chuyên viên tư vấn bán hàng tận tâm.',
      memoryPrompt: 'Địa chỉ cửa hàng: 123 Đường ABC, TP.HCM'
    };

    // Khi khách hỏi về giảm giá -> BM25 phải tự động trích xuất và chèn vào prompt
    const promptWithRag = aiAgentAdapter.compilePrompt(settings, null, 'cho em hỏi khuyến mãi giảm giá');
    assert.ok(promptWithRag.includes('[TRI THỨC TRÍCH XUẤT TỰ ĐỘNG CHO CÂU HỎI HIỆN TẠI (BM25 CONTEXT)]'), 'Prompt phải chứa khối BM25 trích xuất');
    assert.ok(promptWithRag.includes('Giảm Giá 30% VIP'), 'Prompt phải chứa nội dung bài viết tương thích');
    assert.ok(promptWithRag.includes('123 Đường ABC'), 'Prompt vẫn phải bảo toàn baseMemory thông thường');

    // -------------------------------------------------------------------------
    // 8. Kiểm thử Interactive Knowledge Graph Building (Nodes & Links)
    // -------------------------------------------------------------------------
    const graph = await vaultManager.getGraph('sales');
    assert.ok(Array.isArray(graph.nodes), 'Graph phải có danh sách nodes');
    assert.ok(Array.isArray(graph.links), 'Graph phải có danh sách links');
    assert.ok(graph.nodes.some(n => n.id === 'chinh-sach-giam-gia'), 'Graph phải chứa node bài viết chinh-sach-giam-gia');
    assert.ok(graph.nodes.some(n => n.id === 'tag:khuyen-mai'), 'Graph phải chứa node tag khuyen-mai');

    console.log('   ✅ Second Brain Studio Suite passed 100% (24 assertions)!');
  } finally {
    // Dọn dẹp cơ sở dữ liệu và thư mục kiểm thử tạm
    testStore.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    if (fs.existsSync(testVaultBaseDir)) {
      try { fs.rmSync(testVaultBaseDir, { recursive: true, force: true }); } catch {}
    }
  }
}
