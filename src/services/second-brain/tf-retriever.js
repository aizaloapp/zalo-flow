/**
 * Bỏ dấu tiếng Việt để hỗ trợ tìm kiếm không phân biệt có dấu / không dấu.
 */
export function removeVietnameseTones(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Danh sách từ dừng (Stopwords) phổ biến tiếng Việt & tiếng Anh cần loại bỏ khi lập chỉ mục.
 */
export const STOP_WORDS = new Set([
  // Tiếng Việt
  'và', 'của', 'có', 'là', 'trong', 'cho', 'với', 'được', 'khi', 'ở',
  'các', 'những', 'một', 'này', 'đó', 'thì', 'mà', 'để', 'như', 'tại',
  'do', 'bởi', 'về', 'từ', 'ra', 'vào', 'lại', 'rồi', 'sẽ', 'đã',
  'đang', 'phải', 'nên', 'cũng', 'cả', 'nào', 'ai', 'gì', 'sao', 'bao',
  'anh', 'chị', 'em', 'mình', 'bạn', 'vậy', 'nhé', 'ạ', 'ơi', 'hỏi', 'nhiêu',
  'hôm', 'nay', 'hay',
  // Tiếng Anh
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'it', 'its', 'this', 'that', 'these', 'those'
]);

/**
 * Pure TF-Ranking & BM25 Retriever
 * Bộ máy trích xuất ngữ cảnh chạy thuần túy trên CPU bằng JavaScript, Zero-Embedding,
 * đảm bảo thời gian truy vấn <3ms và mức chiếm dụng RAM <10MB per profile.
 */
export class TFRetriever {
  constructor(options = {}) {
    this.k1 = options.k1 ?? 1.2; // Tham số BM25: độ nhạy bão hòa tần suất từ
    this.b = options.b ?? 0.75;  // Tham số BM25: độ phạt độ dài văn bản
    this.titleBoost = options.titleBoost ?? 2.5; // Hệ số nhân ưu tiên cho tiêu đề

    // Lưu trữ tài liệu: Map<docId, DocumentData>
    this.documents = new Map();
    // Inverted Index: Map<token, Set<docId>>
    this.invertedIndex = new Map();
    // Tổng số token trong toàn bộ tập tài liệu
    this.totalTokensCount = 0;
  }

  get docCount() {
    return this.documents.size;
  }

  /**
   * Xóa toàn bộ chỉ mục và tài liệu để nạp lại
   */
  clear() {
    this.documents.clear();
    this.invertedIndex.clear();
    this.totalTokensCount = 0;
  }

  /**
   * Tách từ (Tokenize) chuỗi văn bản thành danh sách unigrams và bigrams đã lọc stopwords.
   * Hỗ trợ dual-index cả phiên bản có dấu và không dấu.
   * @param {string} text
   * @returns {string[]}
   */
  tokenize(text) {
    if (!text || typeof text !== 'string') return [];

    const clean = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!clean) return [];

    const words = clean.split(' ').filter(w => w.length > 0);
    const tokens = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      // 1. Unigram: Lọc từ ngắn <= 1 ký tự và stop words
      if (word.length > 1 && !STOP_WORDS.has(word)) {
        tokens.push(word);
        const noTone = removeVietnameseTones(word);
        if (noTone !== word && noTone.length > 1) {
          tokens.push(noTone);
        }
      }

      // 2. Bigram: Kết hợp 2 từ liên tiếp để nhận diện cụm từ tiếng Việt
      if (i < words.length - 1) {
        const nextWord = words[i + 1];
        if (!STOP_WORDS.has(word) && !STOP_WORDS.has(nextWord)) {
          const bigram = `${word} ${nextWord}`;
          tokens.push(bigram);

          const bigramNoTone = removeVietnameseTones(bigram);
          if (bigramNoTone !== bigram) {
            tokens.push(bigramNoTone);
          }
        }
      }
    }

    return tokens;
  }

  /**
   * Nạp một tài liệu/đoạn trích (Chunk) vào bộ chỉ mục Inverted Index.
   * @param {object} doc - { id, title, content, sourceFile, metadata }
   */
  addDocument(doc) {
    if (!doc || !doc.id) {
      throw new Error('Tài liệu phải có id.');
    }

    if (this.documents.has(doc.id)) {
      this.removeDocument(doc.id);
    }

    const titleTokens = this.tokenize(doc.title || '');
    const contentTokens = this.tokenize(doc.content || '');

    const termFreq = new Map();
    let effectiveLength = 0;

    for (const t of titleTokens) {
      termFreq.set(t, (termFreq.get(t) || 0) + this.titleBoost);
      effectiveLength += this.titleBoost;
    }

    for (const t of contentTokens) {
      termFreq.set(t, (termFreq.get(t) || 0) + 1);
      effectiveLength += 1;
    }

    const docRecord = {
      id: doc.id,
      title: doc.title || '',
      content: doc.content || '',
      sourceFile: doc.sourceFile || '',
      metadata: doc.metadata || {},
      termFreq,
      length: effectiveLength || 1
    };

    this.documents.set(doc.id, docRecord);
    this.totalTokensCount += docRecord.length;

    for (const token of termFreq.keys()) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token).add(doc.id);
    }
  }

  /**
   * Xóa một tài liệu khỏi chỉ mục.
   */
  removeDocument(id) {
    const doc = this.documents.get(id);
    if (!doc) return;

    this.totalTokensCount -= doc.length;

    for (const token of doc.termFreq.keys()) {
      const docSet = this.invertedIndex.get(token);
      if (docSet) {
        docSet.delete(id);
        if (docSet.size === 0) {
          this.invertedIndex.delete(token);
        }
      }
    }

    this.documents.delete(id);
  }

  /**
   * Xóa toàn bộ các chunks liên quan đến một sourceFile cụ thể.
   * @param {string} sourceFile
   */
  removeBySourceFile(sourceFile) {
    if (!sourceFile) return;
    const idsToRemove = [];
    for (const [id, doc] of this.documents.entries()) {
      if (doc.sourceFile === sourceFile) {
        idsToRemove.push(id);
      }
    }
    for (const id of idsToRemove) {
      this.removeDocument(id);
    }
  }

  /**
   * Tính chỉ số Inverse Document Frequency (IDF) theo chuẩn BM25.
   */
  _calculateIdf(token) {
    const N = this.documents.size;
    const docSet = this.invertedIndex.get(token);
    const n = docSet ? docSet.size : 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /**
   * Truy vấn tìm kiếm ngữ cảnh liên quan nhất theo thuật toán BM25.
   * @param {string} queryText - Câu hỏi hoặc từ khóa tìm kiếm
   * @param {object} [options] - { limit, minScore, sourceFile }
   * @returns {Array<object>} Danh sách kết quả xếp theo điểm số giảm dần
   */
  query(queryText, options = {}) {
    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0.2;
    const filterSource = options.sourceFile || null;

    if (!queryText || this.documents.size === 0) return [];

    const queryTokens = this.tokenize(queryText);
    if (queryTokens.length === 0) return [];

    const uniqueQueryTokens = Array.from(new Set(queryTokens));
    const validTokens = uniqueQueryTokens.filter(t => this.invertedIndex.has(t));
    if (validTokens.length === 0) return [];

    let queryMaxScore = 0;
    for (const token of validTokens) {
      const idf = this._calculateIdf(token);
      queryMaxScore += idf * (this.k1 + 1);
    }

    const avgdl = (this.totalTokensCount / this.documents.size) || 1;
    const scores = new Map();
    const matchedTokensMap = new Map();

    const candidateDocIds = new Set();
    for (const token of validTokens) {
      const docSet = this.invertedIndex.get(token);
      if (docSet) {
        for (const docId of docSet) {
          candidateDocIds.add(docId);
        }
      }
    }

    if (candidateDocIds.size === 0) return [];

    const cleanQuery = queryText.toLowerCase().trim();

    for (const docId of candidateDocIds) {
      const doc = this.documents.get(docId);
      if (!doc) continue;
      if (filterSource && doc.sourceFile !== filterSource) continue;

      let score = 0;
      const matched = new Set();

      for (const token of validTokens) {
        const tf = doc.termFreq.get(token);
        if (tf && tf > 0) {
          matched.add(token);
          const idf = this._calculateIdf(token);
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.length / avgdl));
          score += idf * (numerator / denominator);
        }
      }

      if (doc.title.toLowerCase().includes(cleanQuery)) {
        score += 2.5;
      }

      // Anti-Hallucination: Nếu câu hỏi dài mà tài liệu chỉ khớp lẻ tẻ thì bỏ qua
      const totalCoverage = matched.size / uniqueQueryTokens.length;
      if (uniqueQueryTokens.length >= 4 && (matched.size < 2 || totalCoverage < 0.15)) {
        continue;
      }

      if (score > 0) {
        let normalizedScore = queryMaxScore > 0 ? (score / queryMaxScore) : 0;
        normalizedScore = Math.min(1.0, normalizedScore * (0.3 + 0.7 * totalCoverage));

        if (normalizedScore >= minScore) {
          scores.set(docId, normalizedScore);
          matchedTokensMap.set(docId, matched);
        }
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([docId, score]) => {
        const doc = this.documents.get(docId);
        return {
          id: doc.id,
          title: doc.title,
          content: doc.content,
          sourceFile: doc.sourceFile,
          metadata: doc.metadata,
          score: Math.round(score * 1000) / 1000,
          matchedTokens: Array.from(matchedTokensMap.get(docId) || [])
        };
      });
  }

  /**
   * Thống kê kích thước bộ chỉ mục trong RAM
   */
  getMetrics() {
    let indexBytes = 0;
    for (const [token, set] of this.invertedIndex.entries()) {
      indexBytes += token.length * 2 + set.size * 8;
    }
    for (const doc of this.documents.values()) {
      indexBytes += (doc.content?.length || 0) * 2;
    }

    return {
      docCount: this.documents.size,
      tokenCount: this.totalTokensCount,
      uniqueTokens: this.invertedIndex.size,
      memoryKB: Math.round(indexBytes / 1024)
    };
  }
}
