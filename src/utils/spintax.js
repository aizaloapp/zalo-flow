/**
 * Spintax Resolver & Dynamic Variable Personalization Engine
 */

/**
 * Resolve spintax pattern {option1|option2|option3} and replace dynamic variables
 * @param {string} template - Raw spintax template string
 * @param {Object} vars - { name: 'Phan Lê Khoa', threadId: '123' }
 * @returns {string} - Personalized, unique resolved message
 */
export function resolveSpintax(template, vars = {}) {
  if (!template || typeof template !== 'string') return '';

  let result = template;

  // 1. Replace variables {name}, {time}, {date} FIRST
  const customerName = (vars.name || 'bạn').trim();
  result = result.replace(/\{name\}/gi, customerName);

  const hour = new Date().getHours();
  let timeGreeting = 'buổi sáng';
  if (hour >= 12 && hour < 18) {
    timeGreeting = 'buổi chiều';
  } else if (hour >= 18 || hour < 5) {
    timeGreeting = 'buổi tối';
  }
  result = result.replace(/\{time\}/gi, timeGreeting);

  const dayNames = ['Chủ Nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
  const dayStr = dayNames[new Date().getDay()];
  result = result.replace(/\{date\}/gi, dayStr);

  // 2. Resolve nested/flat spintax patterns: {a|b|c} (only when contains '|')
  const spintaxRegex = /\{([^{}]+)\}/g;
  let hasSpin = true;
  let iterations = 0;

  while (hasSpin && iterations < 10) {
    iterations++;
    hasSpin = false;
    result = result.replace(spintaxRegex, (match, choices) => {
      if (choices.includes('|')) {
        hasSpin = true;
        const options = choices.split('|');
        const chosen = options[Math.floor(Math.random() * options.length)];
        return chosen !== undefined ? chosen.trim() : '';
      }
      return match;
    });
  }

  return result.trim();
}

/**
 * Generate preview samples for a template to inspect variation quality
 * @param {string} template - Spintax template
 * @param {Object} vars - Sample variables
 * @param {number} count - Number of samples to generate
 * @returns {Array<string>} - Array of sample resolved strings
 */
export function generateSamplePreviews(template, vars = { name: 'Nguyễn Văn A' }, count = 3) {
  const samples = new Set();
  let attempts = 0;
  while (samples.size < count && attempts < count * 10) {
    samples.add(resolveSpintax(template, vars));
    attempts++;
  }
  return Array.from(samples);
}
