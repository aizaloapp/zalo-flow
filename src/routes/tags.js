import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';

const router = Router();

// GET /api/tags - Get all tags with customer counts
router.get('/tags', requireAuth, (req, res) => {
  try {
    const tags = localStore.getTags();
    res.json({ status: 'success', data: tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tags - Create or update a tag
router.post('/tags', requireAuth, (req, res) => {
  const { id, name, color, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên thẻ không được để trống' });
  }

  try {
    const tag = localStore.upsertTag({ id, name, color, description });
    res.json({ status: 'success', data: tag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tags/:id - Delete a tag
router.delete('/tags/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  try {
    localStore.deleteTag(id);
    res.json({ status: 'success', message: 'Đã xóa thẻ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:threadId/tags - Get tags for a customer
router.get('/conversations/:threadId/tags', requireAuth, (req, res) => {
  const { threadId } = req.params;
  try {
    const tags = localStore.getConversationTags(threadId);
    res.json({ status: 'success', data: tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:threadId/tags - Add tag to customer
router.post('/conversations/:threadId/tags', requireAuth, (req, res) => {
  const { threadId } = req.params;
  const { tagId } = req.body;
  if (!tagId) {
    return res.status(400).json({ error: 'tagId is required' });
  }

  try {
    localStore.addConversationTag(threadId, tagId);
    res.json({ status: 'success', message: 'Đã gắn thẻ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/conversations/:threadId/tags/:tagId - Remove tag from customer
router.delete('/conversations/:threadId/tags/:tagId', requireAuth, (req, res) => {
  const { threadId, tagId } = req.params;
  try {
    localStore.removeConversationTag(threadId, tagId);
    res.json({ status: 'success', message: 'Đã gỡ thẻ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
