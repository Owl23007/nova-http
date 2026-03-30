import * as fs from 'fs';
import * as path from 'path';

const VERSION = '0.1.0';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function green(s: string) { return `${colors.green}${s}${colors.reset}`; }
function blue(s: string) { return `${colors.blue}${s}${colors.reset}`; }
function yellow(s: string) { return `${colors.yellow}${s}${colors.reset}`; }
function red(s: string) { return `${colors.red}${s}${colors.reset}`; }
function bold(s: string) { return `${colors.bold}${s}${colors.reset}`; }
function gray(s: string) { return `${colors.gray}${s}${colors.reset}`; }
function cyan(s: string) { return `${colors.cyan}${s}${colors.reset}`; }

const log = {
  info: (msg: string) => console.log(`  ${blue('ℹ')} ${msg}`),
  success: (msg: string) => console.log(`  ${green('✔')} ${msg}`),
  warn: (msg: string) => console.log(`  ${yellow('⚠')} ${msg}`),
  error: (msg: string) => console.error(`  ${red('✖')} ${msg}`),
  step: (msg: string) => console.log(`  ${cyan('→')} ${msg}`),
};

type InvocationMode = 'command' | 'initializer';

export function runCli(rawArgs: string[], mode: InvocationMode): void {
  const args = [...rawArgs];

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp(mode);
    process.exit(0);
  }

  if (args[0] === '--version' || args[0] === '-v') {
    console.log(VERSION);
    process.exit(0);
  }

  if (mode === 'command') {
    const command = args[0];
    if (command !== 'create') {
      log.error(`未知命令: "${command}"`);
      printHelp(mode);
      process.exit(1);
    }
    args.shift();
  } else if (args[0] === 'create') {
    args.shift();
  }

  const projectName = args[0];
  if (!projectName) {
    log.error('请提供项目名称');
    printUsage(mode);
    process.exit(1);
  }

  if (!/^[a-zA-Z0-9_\-][a-zA-Z0-9_\-\.]*$/.test(projectName)) {
    log.error(`无效的项目名称: "${projectName}"`);
    log.info('项目名称只能包含字母、数字、连字符、下划线和点');
    process.exit(1);
  }

  const templateArg = args.indexOf('--template');
  const template = templateArg !== -1 ? args[templateArg + 1] : 'minimal';
  const force = args.includes('--force') || args.includes('-f');

  if (template !== 'minimal' && template !== 'api') {
    log.error(`未知模板: "${template}"，可选值: minimal, api`);
    process.exit(1);
  }

  createProject(projectName, template as 'minimal' | 'api', force, mode);
}

function printUsage(mode: InvocationMode): void {
  if (mode === 'initializer') {
    console.log('  用法: create-nova-http <项目名称> [--template minimal|api]');
    return;
  }

  console.log('  用法: nova-http create <项目名称> [--template minimal|api]');
}

function printHelp(mode: InvocationMode): void {
  const primaryUsage = mode === 'initializer'
    ? '  create-nova-http <项目名称> [选项]'
    : '  nova-http create <项目名称> [选项]';

  const examples = mode === 'initializer'
    ? [
      '  create-nova-http my-app',
      '  create-nova-http my-api --template api',
      '  create-nova-http my-app --template minimal --force',
    ]
    : [
      '  nova-http create my-app',
      '  nova-http create my-api --template api',
      '  nova-http create my-app --template minimal --force',
    ];

  console.log(`
${bold('Nova')} ${gray(`v${VERSION}`)} — 零依赖高性能 Node.js HTTP 框架脚手架

${bold('用法：')}
${primaryUsage}

${bold('命令：')}
  create <name>   创建新项目（仅 nova-http 命令模式）

${bold('选项：')}
  --template      项目模板 (minimal | api)，默认: minimal
  --force, -f     若目标目录已存在则强制覆盖
  --version, -v   显示版本号
  --help, -h      显示帮助信息

${bold('示例：')}
${examples.join('\n')}

${bold('模板说明：')}
  ${green('minimal')}   最小化 hello world，适合快速体验
  ${green('api')}       带路由/中间件/CRUD 的完整 API 示例，适合生产参考
`);
}

function createProject(
  name: string,
  template: 'minimal' | 'api',
  force: boolean,
  mode: InvocationMode,
): void {
  const targetDir = path.resolve(process.cwd(), name);

  console.log('');
  console.log(`  ${bold('Nova')} 正在创建项目 ${cyan(name)}...`);
  console.log(`  模板: ${green(template)}`);
  console.log(`  路径: ${gray(targetDir)}`);
  console.log('');

  if (fs.existsSync(targetDir)) {
    if (!force) {
      log.error(`目录 "${name}" 已存在`);
      log.info('使用 --force 强制覆盖，或选择其他项目名称');
      process.exit(1);
    }
    log.warn(`目录 "${name}" 已存在，强制覆盖中...`);
  }

  const templateDir = path.join(__dirname, 'templates', template);

  if (!fs.existsSync(templateDir)) {
    log.error(`模板目录不存在: ${templateDir}`);
    log.info('请确认已正确安装 nova-http，或重新执行 npm install');
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  try {
    copyTemplate(templateDir, targetDir, { name });
  } catch (err) {
    log.error(`复制模板时出错: ${(err as Error).message}`);
    process.exit(1);
  }

  const nextCommand = mode === 'initializer' ? 'npm run dev' : 'npm run dev';

  console.log('');
  log.success(bold('项目创建成功！'));
  console.log('');
  console.log('  下一步：');
  console.log('');
  console.log(`    ${gray('$')} cd ${cyan(name)}`);
  console.log(`    ${gray('$')} npm install`);
  console.log(`    ${gray('$')} ${nextCommand}`);
  console.log('');

  if (template === 'api') {
    console.log('  API 端点（启动后）：');
    console.log(`    ${blue('GET')}  http://localhost:3000/`);
    console.log(`    ${blue('GET')}  http://localhost:3000/health`);
    console.log(`    ${blue('GET')}  http://localhost:3000/api/users`);
    console.log(`    ${blue('POST')} http://localhost:3000/api/users`);
    console.log(`    ${blue('GET')}  http://localhost:3000/api/users/:id`);
    console.log('');
  }

  console.log(`  文档: ${blue('https://github.com/nova-http/nova')}`);
  console.log('');
}

interface TemplateVars {
  name: string;
}

function copyTemplate(src: string, dest: string, vars: TemplateVars): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destName = entry.name.replace(/\{\{name\}\}/g, vars.name);
    const destPath = path.join(dest, destName);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath, vars);
    } else if (entry.isFile()) {
      const textExtensions = new Set([
        '.ts', '.js', '.json', '.md', '.txt', '.html', '.css',
        '.env', '.gitignore', '.npmignore', '.yml', '.yaml',
      ]);

      if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
        let content = fs.readFileSync(srcPath, 'utf8');
        content = content.replace(/\{\{name\}\}/g, vars.name);
        fs.writeFileSync(destPath, content, 'utf8');
      } else {
        fs.copyFileSync(srcPath, destPath);
      }

      log.step(destName);
    }
  }
}
