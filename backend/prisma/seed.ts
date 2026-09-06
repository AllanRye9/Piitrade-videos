import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { computeImageHash } from '../src/lib/phash';

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const VIDEOS_DIR = path.join(UPLOAD_ROOT, 'videos');
const POSTERS_DIR = path.join(UPLOAD_ROOT, 'posters');
const PRODUCTS_DIR = path.join(UPLOAD_ROOT, 'products');

for (const dir of [VIDEOS_DIR, POSTERS_DIR, PRODUCTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Seed videos are generated locally with ffmpeg's test-pattern sources so
// the whole app has real, playable sample data on first run with zero
// external network calls (no downloading stock footage).
const SEED_VIDEOS = [
  { id: 'sunset-drive', title: 'Sunset Drive', desc: 'A warm gradient loop — stand-in for a driving montage.', color: '0xff7b3d' },
  { id: 'ocean-blue', title: 'Ocean Horizon', desc: 'Cool blue motion pattern — stand-in for a coastal clip.', color: '0x2d6fbf' },
  { id: 'forest-walk', title: 'Forest Walk', desc: 'Green test pattern — stand-in for a nature walk video.', color: '0x2f9e44' },
  { id: 'city-lights', title: 'City Lights', desc: 'Vivid magenta pattern — stand-in for a night city clip.', color: '0xc2255c' },
  { id: 'desert-gold', title: 'Desert Gold', desc: 'Golden-yellow pattern — stand-in for a desert timelapse.', color: '0xf0b429' },
];

const SEED_PRODUCTS = [
  { name: 'Premium Leather Jacket', price: '$120.00', category: 'Apparel', color: { r: 92, g: 64, b: 51 } },
  { name: 'Designer Handbag', price: '$85.00', category: 'Accessories', color: { r: 176, g: 58, b: 94 } },
  { name: 'Smart Watch Series 7', price: '$75.00', category: 'Electronics', color: { r: 40, g: 40, b: 45 } },
  { name: 'Wireless Headphones', price: '$25.00', category: 'Electronics', color: { r: 230, g: 230, b: 235 } },
  { name: 'Aviator Sunglasses', price: '$18.00', category: 'Accessories', color: { r: 30, g: 30, b: 35 } },
  { name: 'Running Sneakers', price: '$55.00', category: 'Footwear', color: { r: 220, g: 60, b: 40 } },
  { name: 'Canvas Tote Bag', price: '$14.00', category: 'Accessories', color: { r: 210, g: 190, b: 160 } },
  { name: 'Ceramic Mug Set', price: '$12.00', category: 'Home', color: { r: 245, g: 245, b: 240 } },
];

async function generateVideo(v: typeof SEED_VIDEOS[number]): Promise<{ filename: string; poster: string; duration: number }> {
  const filename = `${v.id}.mp4`;
  const outPath = path.join(VIDEOS_DIR, filename);
  const duration = 8;

  if (!fs.existsSync(outPath)) {
    // A solid-color background that slowly rotates hue (real animated
    // motion, not a static frame) with the title burned in via drawtext.
    // Single input, single filter chain — reliable across ffmpeg builds.
    const safeTitle = v.title.replace(/'/g, "\\'").replace(/:/g, '\\:');
    const vf =
      `hue=h=2*PI*t/${duration}*57.3,` +
      `drawtext=text='${safeTitle}':fontcolor=white:fontsize=54:` +
      `x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.35:boxborderw=20`;

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', `color=c=${v.color}:s=1280x720:d=${duration}`,
      '-vf', vf,
      '-t', String(duration),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath,
    ]);
  }

  const posterName = `${v.id}.jpg`;
  const posterOut = path.join(POSTERS_DIR, posterName);
  if (!fs.existsSync(posterOut)) {
    await execFileAsync('ffmpeg', ['-y', '-ss', '1', '-i', outPath, '-frames:v', '1', '-vf', 'scale=640:-1', posterOut]);
  }

  return { filename, poster: posterName, duration };
}

async function generateProductImage(p: typeof SEED_PRODUCTS[number], index: number): Promise<{ filename: string; phash: string }> {
  const filename = `product-${index}.jpg`;
  const outPath = path.join(PRODUCTS_DIR, filename);

  const { r, g, b } = p.color;
  const svg = `
    <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="400" fill="rgb(${r},${g},${b})" />
      <circle cx="200" cy="160" r="90" fill="rgba(255,255,255,0.15)" />
      <rect x="60" y="280" width="280" height="60" rx="12" fill="rgba(0,0,0,0.18)" />
      <text x="200" y="315" font-size="22" font-family="sans-serif" fill="white" text-anchor="middle">${escapeXml(p.name)}</text>
    </svg>`;

  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  fs.writeFileSync(outPath, buffer);
  const phash = await computeImageHash(buffer);
  return { filename, phash };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  console.log('Seeding videos...');
  await prisma.comment.deleteMany();
  await prisma.userVideoState.deleteMany();
  await prisma.video.deleteMany();
  await prisma.product.deleteMany();

  for (const v of SEED_VIDEOS) {
    const { filename, poster, duration } = await generateVideo(v);
    const stat = fs.statSync(path.join(VIDEOS_DIR, filename));
    await prisma.video.create({
      data: {
        title: v.title,
        description: v.desc,
        filename,
        posterFilename: poster,
        mimeType: 'video/mp4',
        size: stat.size,
        duration,
        likes: Math.floor(Math.random() * 5000) + 200,
        views: Math.floor(Math.random() * 40000) + 1000,
        comments: 0,
      },
    });
    console.log(`  ✓ ${v.title}`);
  }

  console.log('Seeding products...');
  for (let i = 0; i < SEED_PRODUCTS.length; i++) {
    const p = SEED_PRODUCTS[i];
    const { filename, phash } = await generateProductImage(p, i);
    await prisma.product.create({
      data: { name: p.name, price: p.price, category: p.category, imageFilename: filename, phash },
    });
    console.log(`  ✓ ${p.name}`);
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
