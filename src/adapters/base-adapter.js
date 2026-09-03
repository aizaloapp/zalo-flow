/**
 * Abstract Base Adapter for Zalo-Flow Integrations
 */
export class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Handle incoming message from Zalo Web
   * @param {Object} context - { message, text, senderId, threadId, isGroup, client }
   */
  async handleInbound(context) {
    // To be overridden by subclasses
  }

  /**
   * Handle incoming HTTP Webhook from external platform
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Object} client - ZaloClient instance
   */
  async handleOutbound(req, res, client) {
    res.status(501).json({ error: `Outbound webhook not implemented for adapter: ${this.name}` });
  }
}
