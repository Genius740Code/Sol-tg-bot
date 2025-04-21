const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');

// Base directory
const baseDir = path.resolve(__dirname, '..');

// Get command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const interactive = args.includes('--interactive');
const verbose = args.includes('--verbose');

// Directories to exclude from cleanup
const excludeDirs = [
  'node_modules',
  '.git',
  'logs',
  'dist',
  'build'
];

// Known directories that are part of the main application
const coreDirs = [
  'src',
  'models',
  'utils',
  'services',
  'handlers',
  'middleware',
  'scripts',
  'config'
];

// Files to exclude from cleanup
const excludeFiles = [
  '.gitignore',
  '.env',
  '.env.template',
  'package.json',
  'package-lock.json',
  'README.md'
];

// Log with conditional verbose output
function log(message, forceOutput = false) {
  if (verbose || forceOutput) {
    console.log(message);
  }
}

// Get all git tracked files
function getGitTrackedFiles() {
  return new Promise((resolve, reject) => {
    exec('git ls-files', { cwd: baseDir }, (error, stdout, stderr) => {
      if (error) {
        console.warn('Git command failed, falling back to manual search');
        resolve([]);
        return;
      }
      resolve(stdout.split('\n').filter(file => file.trim() !== ''));
    });
  });
}

// Find files that were last modified more than X days ago
function findOldFiles(dir, days = 90) {
  const now = new Date();
  const cutoff = new Date(now.setDate(now.getDate() - days));
  
  return new Promise((resolve, reject) => {
    const oldFiles = [];
    
    function scanDir(currentDir) {
      const files = fs.readdirSync(currentDir);
      
      for (const file of files) {
        const filePath = path.join(currentDir, file);
        const relativePath = path.relative(baseDir, filePath);
        
        // Skip excluded directories
        if (fs.statSync(filePath).isDirectory()) {
          if (excludeDirs.includes(file)) {
            continue;
          }
          scanDir(filePath);
          continue;
        }
        
        // Skip excluded files
        if (excludeFiles.includes(file)) {
          continue;
        }
        
        // Check file last modified time
        const stats = fs.statSync(filePath);
        const lastModified = new Date(stats.mtime);
        
        if (lastModified < cutoff) {
          oldFiles.push({
            path: relativePath,
            lastModified,
            size: stats.size
          });
        }
      }
    }
    
    try {
      scanDir(dir);
      resolve(oldFiles);
    } catch (error) {
      reject(error);
    }
  });
}

// Find empty directories
function findEmptyDirs(dir) {
  const emptyDirs = [];
  
  function scanDir(currentDir) {
    const files = fs.readdirSync(currentDir);
    
    if (files.length === 0) {
      const relativePath = path.relative(baseDir, currentDir);
      emptyDirs.push(relativePath);
      return true;
    }
    
    let isEmpty = true;
    
    for (const file of files) {
      const filePath = path.join(currentDir, file);
      const relativePath = path.relative(baseDir, filePath);
      
      // Skip excluded directories
      if (fs.statSync(filePath).isDirectory()) {
        if (excludeDirs.includes(file)) {
          isEmpty = false;
          continue;
        }
        
        const isSubdirEmpty = scanDir(filePath);
        if (!isSubdirEmpty) {
          isEmpty = false;
        }
      } else {
        isEmpty = false;
      }
    }
    
    if (isEmpty) {
      const relativePath = path.relative(baseDir, currentDir);
      emptyDirs.push(relativePath);
    }
    
    return isEmpty;
  }
  
  scanDir(dir);
  return emptyDirs.filter(dir => dir !== '');
}

// Find duplicate directories (potentially due to incorrect copying/moving)
function findPotentialDuplicateDirs() {
  const directories = fs.readdirSync(baseDir)
    .filter(file => {
      const filePath = path.join(baseDir, file);
      return fs.statSync(filePath).isDirectory() && !excludeDirs.includes(file);
    });
  
  const potentialDuplicates = [];
  
  for (const dir1 of directories) {
    for (const dir2 of directories) {
      if (dir1 !== dir2 && dir1.includes(dir2) || dir2.includes(dir1)) {
        if (!potentialDuplicates.includes(dir1) && !coreDirs.includes(dir1)) {
          potentialDuplicates.push(dir1);
        }
        if (!potentialDuplicates.includes(dir2) && !coreDirs.includes(dir2)) {
          potentialDuplicates.push(dir2);
        }
      }
    }
  }
  
  return potentialDuplicates;
}

// Delete a file or directory
function deleteFileOrDir(filePath, isDir = false) {
  const fullPath = path.join(baseDir, filePath);
  
  try {
    if (isDir) {
      fs.rmdirSync(fullPath, { recursive: true });
      log(`Deleted directory: ${filePath}`, true);
    } else {
      fs.unlinkSync(fullPath);
      log(`Deleted file: ${filePath}`, true);
    }
    return true;
  } catch (error) {
    console.error(`Error deleting ${isDir ? 'directory' : 'file'} ${filePath}:`, error.message);
    return false;
  }
}

// Ask for confirmation in interactive mode
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

// Main cleanup function
async function cleanupUnusedFiles() {
  log('Starting cleanup process...', true);
  log(`Mode: ${dryRun ? 'Dry run' : 'Delete'} ${interactive ? '(Interactive)' : ''}`, true);
  
  try {
    // Get git tracked files if available
    const gitTrackedFiles = await getGitTrackedFiles();
    log(`Found ${gitTrackedFiles.length} git tracked files`);
    
    // Find old files
    const oldFiles = await findOldFiles(baseDir);
    log(`Found ${oldFiles.length} files not modified in the last 90 days`);
    
    // Find empty directories
    const emptyDirs = findEmptyDirs(baseDir);
    log(`Found ${emptyDirs.length} empty directories`);
    
    // Find potential duplicate directories
    const duplicateDirs = findPotentialDuplicateDirs();
    log(`Found ${duplicateDirs.length} potentially duplicate directories`);
    
    // Output findings
    if (verbose) {
      if (oldFiles.length > 0) {
        console.log('\nOld files:');
        oldFiles.forEach(file => {
          console.log(`- ${file.path} (Last modified: ${file.lastModified.toISOString().split('T')[0]}, Size: ${(file.size / 1024).toFixed(2)} KB)`);
        });
      }
      
      if (emptyDirs.length > 0) {
        console.log('\nEmpty directories:');
        emptyDirs.forEach(dir => {
          console.log(`- ${dir}`);
        });
      }
      
      if (duplicateDirs.length > 0) {
        console.log('\nPotentially duplicate directories:');
        duplicateDirs.forEach(dir => {
          console.log(`- ${dir}`);
        });
      }
    }
    
    // Perform cleanup if not dry run
    if (!dryRun) {
      log('\nStarting cleanup...', true);
      
      // Delete empty directories
      for (const dir of emptyDirs) {
        if (interactive) {
          const confirm = await askForConfirmation(`Delete empty directory '${dir}'?`);
          if (confirm) {
            deleteFileOrDir(dir, true);
          }
        } else {
          deleteFileOrDir(dir, true);
        }
      }
      
      // Delete old files (that aren't in git)
      for (const file of oldFiles) {
        // Skip git tracked files
        if (gitTrackedFiles.includes(file.path)) {
          log(`Skipping git tracked file: ${file.path}`);
          continue;
        }
        
        if (interactive) {
          const confirm = await askForConfirmation(`Delete old file '${file.path}'?`);
          if (confirm) {
            deleteFileOrDir(file.path);
          }
        } else {
          deleteFileOrDir(file.path);
        }
      }
      
      // Handle duplicate directories
      if (duplicateDirs.length > 0) {
        log('\nPotential duplicate directories require manual review:', true);
        duplicateDirs.forEach(dir => {
          console.log(`- ${dir}`);
        });
      }
      
      log('\nCleanup completed!', true);
    } else {
      log('\nDry run completed. No files were deleted.', true);
    }
    
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// Run the cleanup
cleanupUnusedFiles().catch(console.error); 