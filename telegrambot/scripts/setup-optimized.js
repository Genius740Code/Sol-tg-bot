const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const scriptsDir = __dirname;
const baseDir = path.resolve(__dirname, '..');

// Available optimization tasks
const tasks = [
  {
    name: 'Clean up unused files',
    script: 'cleanup.js',
    args: ['--interactive']
  },
  {
    name: 'Migrate settings to database',
    script: 'migrate-settings.js',
    args: []
  },
  {
    name: 'Update package.json dependencies',
    function: updatePackageJson
  }
];

// Ask for confirmation
function askForConfirmation(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(`${message} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// Run script as a promise
function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(scriptsDir, scriptPath);
    const command = `node "${fullPath}" ${args.join(' ')}`;
    
    console.log(`Running: ${command}`);
    
    const childProcess = exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing ${scriptPath}:`, error);
        reject(error);
        return;
      }
      
      if (stderr) {
        console.error(`${scriptPath} stderr:`, stderr);
      }
      
      console.log(stdout);
      resolve();
    });
    
    // Forward output to console
    childProcess.stdout.pipe(process.stdout);
    childProcess.stderr.pipe(process.stderr);
  });
}

// Update package.json to use only necessary dependencies and add missing ones
async function updatePackageJson() {
  const packageJsonPath = path.join(baseDir, 'package.json');
  
  try {
    console.log('Updating package.json...');
    
    // Read the current package.json
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Required dependencies
    const requiredDeps = {
      '@solana/web3.js': '^1.98.0',
      'axios': '^1.6.0',
      'bs58': '^6.0.0',
      'crypto': '^1.0.1',
      'dotenv': '^16.5.0',
      'express': '^4.18.2',
      'jsonwebtoken': '^9.0.2',
      'mongoose': '^8.0.0',
      'node-cache': '^5.1.2',
      'node-fetch': '^2.7.0',
      'node-schedule': '^2.1.1',
      'telegraf': '^4.15.0',
      'winston': '^3.11.0'
    };
    
    // Update dependencies
    packageJson.dependencies = packageJson.dependencies || {};
    
    // Add or update required dependencies
    for (const [dep, version] of Object.entries(requiredDeps)) {
      packageJson.dependencies[dep] = version;
    }
    
    // Add scripts if not present
    packageJson.scripts = packageJson.scripts || {};
    packageJson.scripts.start = 'node src/index.js';
    packageJson.scripts.dev = 'nodemon src/index.js';
    packageJson.scripts.setup = 'node scripts/setup-optimized.js';
    packageJson.scripts.cleanup = 'node scripts/cleanup.js --interactive';
    packageJson.scripts['migrate-settings'] = 'node scripts/migrate-settings.js';
    
    // Add engines section for Node.js version
    packageJson.engines = {
      node: '>=16.0.0'
    };
    
    // Write the updated package.json
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    console.log('Package.json updated successfully');
    return true;
  } catch (error) {
    console.error('Error updating package.json:', error);
    return false;
  }
}

// Main function to run all tasks
async function runSetup() {
  console.log('========================================');
  console.log('   Optimized Setup for Telegram Bot');
  console.log('========================================');
  console.log('This script will:');
  
  // List all tasks
  tasks.forEach((task, index) => {
    console.log(`${index + 1}. ${task.name}`);
  });
  
  console.log('========================================');
  
  const confirm = await askForConfirmation('Do you want to continue?');
  if (!confirm) {
    console.log('Setup canceled.');
    return;
  }
  
  // Run tasks
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    
    console.log(`\n[${i + 1}/${tasks.length}] ${task.name}...`);
    
    try {
      if (task.script) {
        await runScript(task.script, task.args);
      } else if (task.function) {
        await task.function();
      }
      
      console.log(`✓ ${task.name} completed successfully`);
    } catch (error) {
      console.error(`✗ ${task.name} failed:`, error);
      
      const continueExecution = await askForConfirmation('Continue with the next task?');
      if (!continueExecution) {
        console.log('Setup aborted.');
        return;
      }
    }
  }
  
  console.log('\n========================================');
  console.log('   Setup completed successfully!');
  console.log('========================================');
  console.log('Next steps:');
  console.log('1. Install dependencies: npm install');
  console.log('2. Start the bot: npm start');
  console.log('3. Ensure MongoDB is running');
  console.log('========================================');
}

// Run the setup
runSetup().catch(console.error); 