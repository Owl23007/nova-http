const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist');
const tempRoot = path.join(repoRoot, '.tmp', 'verify-create');

class ExitSignal extends Error {
  constructor(code) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function formatDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => ts.sys.newLine,
  });
}

function compileTsconfig(tsconfigPath) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(formatDiagnostics([configFile.error]));
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

  if (parsed.errors.length > 0) {
    throw new Error(formatDiagnostics(parsed.errors));
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

  if (diagnostics.length > 0) {
    throw new Error(formatDiagnostics(diagnostics));
  }
}

function buildPackage() {
  console.log('1/4 构建 dist 产物');
  fs.rmSync(distRoot, { recursive: true, force: true });
  compileTsconfig(path.join(repoRoot, 'tsconfig.build.json'));
  fs.cpSync(path.join(repoRoot, 'cli', 'templates'), path.join(distRoot, 'cli', 'templates'), { recursive: true });

  assert(fs.existsSync(path.join(distRoot, 'cli', 'nova.js')), '缺少 dist/cli/nova.js');
  assert(fs.existsSync(path.join(distRoot, 'cli', 'create-nova.js')), '缺少 dist/cli/create-nova.js');
  assert(fs.existsSync(path.join(distRoot, 'cli', 'templates', 'minimal', 'package.json')), '缺少 minimal 模板');
  assert(fs.existsSync(path.join(distRoot, 'cli', 'templates', 'api', 'package.json')), '缺少 api 模板');
}

function loadCli() {
  const sharedPath = path.join(distRoot, 'cli', 'shared.js');
  delete require.cache[require.resolve(sharedPath)];
  return require(sharedPath);
}

function invokeCli(args, mode, cwd, options = {}) {
  const { runCli } = loadCli();
  const previousCwd = process.cwd();
  const previousExit = process.exit;
  const previousLog = console.log;
  const previousError = console.error;

  try {
    process.chdir(cwd);
    process.exit = ((code = 0) => {
      throw new ExitSignal(code);
    });
    if (options.quiet) {
      console.log = () => {};
      console.error = () => {};
    }
    runCli(args, mode);
    return 0;
  } catch (error) {
    if (error instanceof ExitSignal) {
      return error.code;
    }
    throw error;
  } finally {
    process.exit = previousExit;
    console.log = previousLog;
    console.error = previousError;
    process.chdir(previousCwd);
  }
}

function assertNoTemplateMarker(dir) {
  const textExtensions = new Set([
    '.ts', '.js', '.json', '.md', '.txt', '.html', '.css',
    '.env', '.gitignore', '.npmignore', '.yml', '.yaml',
  ]);

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!textExtensions.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      assert(!content.includes('{{name}}'), `模板变量未替换: ${fullPath}`);
    }
  };

  walk(dir);
}

function linkLocalNovaPackage(projectDir) {
  const nodeModulesDir = path.join(projectDir, 'node_modules');
  const localNovaLink = path.join(nodeModulesDir, 'nova-http');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  fs.rmSync(localNovaLink, { recursive: true, force: true });
  fs.symlinkSync(repoRoot, localNovaLink, 'junction');
}

function verifyGeneratedProject(projectDir, expectedName, expectedFiles) {
  const packageJson = readJson(path.join(projectDir, 'package.json'));
  assert(packageJson.name === expectedName, `package.json name 不匹配: ${packageJson.name}`);

  for (const relativePath of expectedFiles) {
    const filePath = path.join(projectDir, relativePath);
    assert(fs.existsSync(filePath), `缺少生成文件: ${filePath}`);
  }

  assertNoTemplateMarker(projectDir);
  linkLocalNovaPackage(projectDir);
  compileTsconfig(path.join(projectDir, 'tsconfig.json'));
}

function verifyCommandMode() {
  console.log('2/4 验证 `nova-http create` 入口');
  const code = invokeCli(['create', 'cli-minimal', '--template', 'minimal'], 'command', tempRoot);
  assert(code === 0, '`nova-http create` 应成功');

  verifyGeneratedProject(path.join(tempRoot, 'cli-minimal'), 'cli-minimal', [
    'app.ts',
    'package.json',
    'tsconfig.json',
  ]);
}

function verifyInitializerMode() {
  console.log('3/4 验证 `create-nova-http` 入口');
  const createCode = invokeCli(['init-api', '--template', 'api'], 'initializer', tempRoot);
  assert(createCode === 0, '`create-nova-http` 应成功');

  const initProject = path.join(tempRoot, 'init-api');
  verifyGeneratedProject(initProject, 'init-api', [
    'app.ts',
    'package.json',
    'tsconfig.json',
    path.join('routes', 'users.ts'),
    path.join('routes', 'health.ts'),
    path.join('middlewares', 'auth.ts'),
    path.join('middlewares', 'logger.ts'),
  ]);

  const failCode = invokeCli(['init-api', '--template', 'api'], 'initializer', tempRoot, { quiet: true });
  assert(failCode !== 0, '重复创建不带 --force 应失败');

  const forceCode = invokeCli(['init-api', '--template', 'api', '--force'], 'initializer', tempRoot);
  assert(forceCode === 0, '重复创建带 --force 应成功');
  verifyGeneratedProject(initProject, 'init-api', [
    'app.ts',
    'package.json',
    'tsconfig.json',
    path.join('routes', 'users.ts'),
    path.join('routes', 'health.ts'),
    path.join('middlewares', 'auth.ts'),
    path.join('middlewares', 'logger.ts'),
  ]);
}

function verifyPackageMetadata() {
  console.log('4/4 验证 package 元数据');
  const packageJson = readJson(path.join(repoRoot, 'package.json'));
  assert(packageJson.bin && packageJson.bin['nova-http'], 'package.json 缺少 nova-http bin');
  assert(packageJson.bin && packageJson.bin['create-nova-http'], 'package.json 缺少 create-nova-http bin');
}

function main() {
  try {
    console.log('验证目标: 脚手架构建产物完整，`nova-http create` 与 initializer 风格入口都可生成模板并通过本地 TypeScript 构建。');
    console.log('说明: 运行时包名已切换为 `nova-http`，initializer 入口对应 `create-nova-http`。');

    ensureCleanDir(tempRoot);
    buildPackage();
    verifyCommandMode();
    verifyInitializerMode();
    verifyPackageMetadata();

    fs.rmSync(tempRoot, { recursive: true, force: true });
    console.log('\nverify:create 通过');
  } catch (error) {
    console.error(`\nverify:create 失败: ${error.message}`);
    console.error(`调试目录保留在: ${tempRoot}`);
    process.exitCode = 1;
  }
}

main();
