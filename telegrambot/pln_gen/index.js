const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// Configuration
const config = {
  imageFolder: './telegrambot/pln_gen/images',
  outputFolder: './telegrambot/pln_gen/output',  // Folder to store output
  outputImageName: 'output.jpg',  // Output file name
  text: 'Hello, World!',
  font: 'bold 40px Arial',
  color: 'white',
  x: 50,
  y: 100
};

function getRandomImages(folderPath, count = 1) {
  const files = fs.readdirSync(folderPath).filter(file =>
    ['.png', '.jpg', '.jpeg'].includes(path.extname(file).toLowerCase())
  );

  if (files.length === 0) throw new Error('No image files found in folder.');

  // Shuffle and pick the first few
  const shuffled = files.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map(file => path.join(folderPath, file));
}

function getOptimalTextPosition(imageWidth, imageHeight) {
  // Calculate optimal position for text, assuming the text shouldn't be too close to edges
  const padding = 20;  // Padding from the edges of the image

  let x = padding;
  let y = padding + 40; // Just below the top, adjust based on font size

  // Adjust for large images by moving text lower (but not too far)
  if (imageHeight > 800) {
    y = imageHeight - padding - 40; // Place it near the bottom
  }

  return { x, y };
}

async function generateImage() {
  try {
    const [randomImagePath] = getRandomImages(config.imageFolder, 1);
    console.log('📷 Using image:', randomImagePath);

    const image = await loadImage(randomImagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    // Draw image
    ctx.drawImage(image, 0, 0);

    // Set text style
    ctx.font = config.font;
    ctx.fillStyle = config.color;

    // Get optimal position for text
    const { x, y } = getOptimalTextPosition(image.width, image.height);
    console.log(`Text will be placed at: x=${x}, y=${y}`);

    // Draw text at the optimal position
    ctx.fillText(config.text, x, y);

    // Ensure output folder exists
    if (!fs.existsSync(config.outputFolder)) {
      fs.mkdirSync(config.outputFolder, { recursive: true });
    }

    // Save output with proper path
    const outputImagePath = path.join(config.outputFolder, config.outputImageName);
    const buffer = canvas.toBuffer('image/jpeg');
    fs.writeFileSync(outputImagePath, buffer);
    console.log('✅ Image saved as', outputImagePath);
  } catch (err) {
    console.error('❌ Error generating image:', err.message);
  }
}

generateImage();
