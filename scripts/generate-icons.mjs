import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
const sourceSvgPath = resolve(publicDir, 'icon.svg');

function buildFullBleedSvg(svgSource, scale) {
  const defsMatch = svgSource.match(/<defs>[\s\S]*?<\/defs>/);
  if (!defsMatch) {
    throw new Error('Could not locate <defs>...</defs> in public/icon.svg');
  }
  const defsBlock = defsMatch[0];
  const defsEnd = svgSource.indexOf('</defs>') + '</defs>'.length;
  const svgClose = svgSource.lastIndexOf('</svg>');
  if (svgClose === -1) {
    throw new Error('Could not locate </svg> in public/icon.svg');
  }

  let innerArtwork = svgSource.slice(defsEnd, svgClose);
  // Strip the rounded-corner container & border <rect> elements (lines 49-50 of icon.svg)
  innerArtwork = innerArtwork.replace(
    /<rect\b[^>]*\srx="(?:112|110)"[^>]*\/>\s*/g,
    '',
  );

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">',
    defsBlock,
    '<rect width="512" height="512" fill="#0f172a"/>',
    `<g transform="translate(256, 256) scale(${scale}) translate(-256, -256)">`,
    innerArtwork,
    '</g>',
    '</svg>',
  ].join('\n');
}

function renderPng(svgMarkup, size) {
  const resvg = new Resvg(svgMarkup, {
    fitTo: {
      mode: 'width',
      value: size,
    },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Segoe UI',
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

async function main() {
  const rawSvg = await readFile(sourceSvgPath, 'utf8');
  const normalizedSvg = rawSvg.replace(
    'width="100%" height="100%"',
    'width="512" height="512"',
  );

  const maskableSvg = buildFullBleedSvg(normalizedSvg, 0.74);
  const appleTouchSvg = buildFullBleedSvg(normalizedSvg, 0.88);

  const outputs = [
    { file: 'pwa-192x192.png', svg: normalizedSvg, size: 192 },
    { file: 'pwa-512x512.png', svg: normalizedSvg, size: 512 },
    { file: 'pwa-maskable-512x512.png', svg: maskableSvg, size: 512 },
    { file: 'apple-touch-icon-180x180.png', svg: appleTouchSvg, size: 180 },
  ];

  for (const { file, svg, size } of outputs) {
    const pngBuffer = renderPng(svg, size);
    const outPath = resolve(publicDir, file);
    await writeFile(outPath, pngBuffer);
    console.log(`Generated ${outPath} (${size}x${size}, ${pngBuffer.length} bytes)`);
  }
}

main().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exitCode = 1;
});
