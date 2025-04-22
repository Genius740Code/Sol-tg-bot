const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');

// Configuration
const config = {
  imagePath: './images/pln.png',        // Path to your image
  outputImagePath: 'output.jpg', // Output path
  text: 'Hello, World!',         // Text to draw
  font: 'bold 40px Arial',       // Font style
  color: 'white',                // Text color
  x: 50,                         // X position
  y: 100                         // Y position
};

async function generateImage() {
  try {
    const image = await loadImage(config.imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    // Draw the image
    ctx.drawImage(image, 0, 0);

    // Set text style
    ctx.font = config.font;
    ctx.fillStyle = config.color;
    ctx.fillText(config.text, config.x, config.y);

    // Save to file
    const buffer = canvas.toBuffer('image/jpeg');
    fs.writeFileSync(config.outputImagePath, buffer);
    console.log('✅ Image saved as', config.outputImagePath);
  } catch (err) {
    console.error('❌ Error generating image:', err);
  }
}

generateImage();
