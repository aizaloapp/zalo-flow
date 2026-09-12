import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const qrOutputDir = path.join(rootDir, 'public', 'assets', 'qr');

if (!fs.existsSync(qrOutputDir)) {
  fs.mkdirSync(qrOutputDir, { recursive: true });
}

const DONATE_CHANNELS = [
  {
    name: 'kofi',
    file: 'qr-kofi.svg',
    data: 'https://ko-fi.com/aizalo',
    options: {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    }
  },
  {
    name: 'paypal',
    file: 'qr-paypal.svg',
    data: 'https://paypal.me/lekhoa288',
    options: {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    }
  },
  {
    name: 'momo',
    file: 'qr-momo.svg',
    data: '2|99|0973947264|||0|0|',
    options: {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    }
  }
];

async function generateQRCodes() {
  console.log('🔄 Đang sinh các mã QR SVG tĩnh cho Zalo-Flow Donate...');
  for (const channel of DONATE_CHANNELS) {
    const targetPath = path.join(qrOutputDir, channel.file);
    const svgString = await QRCode.toString(channel.data, channel.options);
    fs.writeFileSync(targetPath, svgString, 'utf8');
    console.log(`✅ Đã tạo: ${channel.file} (${svgString.length} bytes)`);
  }
  console.log('🎉 Hoàn tất sinh mã QR SVG!');
}

generateQRCodes().catch(err => {
  console.error('❌ Lỗi khi sinh QR:', err);
  process.exit(1);
});
