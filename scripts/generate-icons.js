// Script para gerar ícones PNG a partir do SVG
// Execute: node scripts/generate-icons.js
// Requer: npm install sharp

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const svgPath = path.join(__dirname, '../public/icons/icon.svg');
const outputDir = path.join(__dirname, '../public/icons');

async function generateIcons() {
    const svgBuffer = fs.readFileSync(svgPath);
    
    for (const size of sizes) {
        const outputPath = path.join(outputDir, `icon-${size}.png`);
        await sharp(svgBuffer)
            .resize(size, size)
            .png()
            .toFile(outputPath);
        console.log(`Generated: icon-${size}.png`);
    }
    
    // Generate screenshots (placeholder)
    await sharp(svgBuffer)
        .resize(1280, 720, { fit: 'contain', background: '#1a1a2e' })
        .png()
        .toFile(path.join(outputDir, 'screenshot-wide.png'));
    console.log('Generated: screenshot-wide.png');
    
    await sharp(svgBuffer)
        .resize(720, 1280, { fit: 'contain', background: '#1a1a2e' })
        .png()
        .toFile(path.join(outputDir, 'screenshot-mobile.png'));
    console.log('Generated: screenshot-mobile.png');
    
    console.log('\\nAll icons generated successfully!');
}

generateIcons().catch(console.error);
