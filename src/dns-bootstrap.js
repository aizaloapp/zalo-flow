/**
 * Zalo-Flow DNS Bootstrap
 * Force IPv4-first resolution to prevent IPv6 timeouts in Vietnamese ISP networks.
 */
import dns from 'node:dns';

try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch {
  // Ignore if not supported
}

