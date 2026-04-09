import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';

interface PackageMeta {
  name?: string;
  version?: string;
}

function readPackageMeta(startDir: string): PackageMeta {
  let currentDir = startDir;

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageMeta;
      } catch {
        // Ignore invalid package.json files outside the current package.
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return {};
}

const PACKAGE_META = readPackageMeta(__dirname);
const VERSION = PACKAGE_META.version ?? '0.1.0';
const FRAMEWORK_VERSION_RANGE = VERSION === '0.1.0' ? '^0.1.0' : `^${VERSION}`;
const DEFAULT_PROJECT_VERSION = '0.1.0';

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
  info: (msg: string) => console.log(`  ${blue('i')} ${msg}`),
  success: (msg: string) => console.log(`  ${green('OK')} ${msg}`),
  warn: (msg: string) => console.log(`  ${yellow('!')} ${msg}`),
  error: (msg: string) => console.error(`  ${red('x')} ${msg}`),
  step: (msg: string) => console.log(`  ${cyan('->')} ${msg}`),
};

type InvocationMode = 'command' | 'initializer';
type TemplateKind = 'minimal' | 'api';
type ProjectLanguage = 'ts' | 'js';

interface CliOptions {
  name: string;
  template: TemplateKind;
  lang: ProjectLanguage;
  force: boolean;
}

interface Choice<T extends string> {
  key: string;
  label: string;
  value: T;
  description?: string;
}

export async function runCli(rawArgs: string[], mode: InvocationMode): Promise<void> {
  const args = [...rawArgs];

  if (args[0] === '--help' || args[0] === '-h') {
    printHelp(mode);
    return;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    console.log(VERSION);
    return;
  }

  if (mode === 'command') {
    if (args.length === 0) {
      if (canUseInteractive()) {
        createProjectFromOptions(await runInteractive(mode), mode);
        return;
      }
      printHelp(mode);
      return;
    }

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

  if (args.length === 0 && canUseInteractive()) {
    createProjectFromOptions(await runInteractive(mode), mode);
    return;
  }

  createProjectFromOptions(parseArgs(args, mode), mode);
}

function parseArgs(args: string[], mode: InvocationMode): CliOptions {
  const projectName = args[0];
  if (!projectName) {
    log.error('请提供项目名称');
    printUsage(mode);
    process.exit(1);
  }

  validateProjectName(projectName);

  const templateArg = args.indexOf('--template');
  const template = templateArg !== -1 ? args[templateArg + 1] : 'minimal';
  const langArg = args.indexOf('--lang');
  const lang = langArg !== -1 ? args[langArg + 1] : 'ts';
  const force = args.includes('--force') || args.includes('-f');

  if (template !== 'minimal' && template !== 'api') {
    log.error(`未知模板: "${template}"，可选值: minimal, api`);
    process.exit(1);
  }

  if (lang !== 'ts' && lang !== 'js') {
    log.error(`未知语言: "${lang}"，可选值: ts, js`);
    process.exit(1);
  }

  return {
    name: projectName,
    template: template as TemplateKind,
    lang: lang as ProjectLanguage,
    force,
  };
}

function printUsage(mode: InvocationMode): void {
  if (mode === 'initializer') {
    console.log('  用法: create-nova-http [项目名称] [--template minimal|api] [--lang ts|js]');
    return;
  }

  console.log('  用法: nova-http create [项目名称] [--template minimal|api] [--lang ts|js]');
}

function printHelp(mode: InvocationMode): void {
  const primaryUsage = mode === 'initializer'
    ? '  create-nova-http [项目名称] [选项]'
    : '  nova-http create [项目名称] [选项]';

  const examples = mode === 'initializer'
    ? [
      '  create-nova-http',
      '  create-nova-http my-app',
      '  create-nova-http my-api --template api',
      '  create-nova-http my-app --lang js',
    ]
    : [
      '  nova-http create',
      '  nova-http create my-app',
      '  nova-http create my-api --template api',
      '  nova-http create my-app --lang js',
    ];

  console.log(`
${bold('Nova')} ${gray(`v${VERSION}`)} - 零依赖高性能 Node.js HTTP 框架脚手架

${bold('用法：')}
${primaryUsage}

${bold('命令：')}
  create <name>   创建新项目
  create          交互式创建

${bold('选项：')}
  --template      项目模板 (minimal | api)，默认: minimal
  --lang          项目语言 (ts | js)，默认: ts
  --force, -f     若目标目录已存在则强制覆盖
  --version, -v   显示版本号
  --help, -h      显示帮助信息

${bold('示例：')}
${examples.join('\n')}

${bold('模板说明：')}
  ${green('minimal')}   最小项目，快速开始
  ${green('api')}       带路由/中间件/CRUD 的完整 API 示例

${bold('语言说明：')}
  ${green('ts')}        TypeScript 项目模板
  ${green('js')}        CommonJS JavaScript 项目模板
`);
}

function canUseInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function validateProjectName(projectName: string): void {
  if (!/^[a-zA-Z0-9_\-][a-zA-Z0-9_\-\.]*$/.test(projectName)) {
    log.error(`无效的项目名称: "${projectName}"`);
    log.info('项目名称只能包含字母、数字、连字符、下划线和点');
    process.exit(1);
  }
}

async function runInteractive(mode: InvocationMode): Promise<CliOptions> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('');
    printInteractiveBanner();
    console.log('');

    const name = await askProjectName(rl);
    const template = await askChoice(
      rl,
      '1/3 选择模板',
      [
        { key: '1', label: 'minimal', value: 'minimal', description: '最小化框架，快速开始' },
        { key: '2', label: 'api', value: 'api', description: '带路由、中间件和 CRUD 的完整示例' },
      ],
      '1',
    );
    const lang = await askChoice(
      rl,
      '2/3 选择语言',
      [
        { key: '1', label: 'ts', value: 'ts', description: 'TypeScript 项目模板' },
        { key: '2', label: 'js', value: 'js', description: 'CommonJS JavaScript 项目模板' },
      ],
      '1',
    );

    let force = false;
    const targetDir = path.resolve(process.cwd(), name);
    if (fs.existsSync(targetDir)) {
      force = await askConfirm(rl, `目录 "${name}" 已存在，是否覆盖`, false);
      if (!force) {
        log.error('已取消创建');
        process.exit(1);
      }
    }

    console.log('');
    printInteractiveSummary({ name, template, lang, force }, mode);
    return { name, template, lang, force };
  } catch (error) {
    if (isAbortError(error)) {
      handleInteractiveAbort();
    }
    throw error;
  } finally {
    rl.close();
  }
}

function isAbortError(error: unknown): error is Error & { code?: string } {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;

  return error.name === 'AbortError' || code === 'ABORT_ERR';
}

function handleInteractiveAbort(): never {
  console.log('');
  log.warn('已取消创建');
  process.exit();
}

async function askProjectName(rl: readline.Interface): Promise<string> {
  console.log(`  ${bold(blue('0/3 项目名称'))}`);
  console.log(`  ${gray('  请输入项目目录名称，例如 my-app')}`);
  while (true) {
    const answer = (await rl.question(`  ${cyan('>')} 项目名称: `)).trim();
    if (answer === '') {
      log.warn('项目名称不能为空');
      continue;
    }
    if (!/^[a-zA-Z0-9_\-][a-zA-Z0-9_\-\.]*$/.test(answer)) {
      log.warn('项目名称只能包含字母、数字、连字符、下划线和点');
      continue;
    }
    return answer;
  }
}

async function askChoice<T extends string>(
  rl: readline.Interface,
  title: string,
  options: Choice<T>[],
  defaultKey: string,
): Promise<T> {
  console.log(`  ${bold(blue(title))}`);
  for (const option of options) {
    const hint = option.key === defaultKey ? '' : '';
    const label = `${option.key}. ${option.label}${hint}`;
    console.log(`  ${cyan(label.padEnd(18, ' '))}${option.description ? gray(option.description) : ''}`);
  }

  while (true) {
    const answer = (await rl.question(`  ${cyan('>')} 输入编号 [${defaultKey}]: `)).trim() || defaultKey;
    const selected = options.find((option) => option.key === answer);
    if (selected) {
      console.log(`  ${green('已选择')} ${bold(selected.label)}`);
      console.log('');
      return selected.value;
    }
    log.warn('无效选项，请重新输入');
  }
}

async function askConfirm(
  rl: readline.Interface,
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  while (true) {
    const answer = (await rl.question(`  ${question} [${hint}]: `)).trim().toLowerCase();
    if (answer === '') return defaultValue;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    log.warn('请输入 y 或 n');
  }
}

function printInteractiveBanner(): void {
  console.log(`  ${bold('Nova')} ${cyan('交互式创建向导')}`);


}

function printInteractiveSummary(options: CliOptions, mode: InvocationMode): void {
  console.log(`  ${bold(blue('3/3 创建预览'))}`);
  console.log(`  ${gray('  命令')}   ${mode === 'command' ? 'nova-http create' : 'create-nova-http'}`);
  console.log(`  ${gray('  项目')}   ${bold(options.name)}`);
  console.log(`  ${gray('  模板')}   ${options.template}`);
  console.log(`  ${gray('  语言')}   ${options.lang}`);
  console.log(`  ${gray('  覆盖')}   ${options.force ? 'yes' : 'no'}`);
}

function createProjectFromOptions(options: CliOptions, mode: InvocationMode): void {
  createProject(options.name, options.template, options.lang, options.force, mode);
}

function createProject(
  name: string,
  template: TemplateKind,
  lang: ProjectLanguage,
  force: boolean,
  mode: InvocationMode,
): void {
  const targetDir = path.resolve(process.cwd(), name);

  console.log('');
  console.log(`  ${bold('Nova')} 正在创建项目 ${cyan(name)}...`);
  console.log(`  模板: ${green(template)}`);
  console.log(`  语言: ${green(lang)}`);
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

  const templateDir = path.join(
    __dirname,
    'templates',
    lang === 'ts' ? template : `${template}-js`,
  );

  if (!fs.existsSync(templateDir)) {
    log.error(`模板目录不存在: ${templateDir}`);
    log.info('请确认已正确安装 nova-http，或重新执行 npm install');
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  try {
    copyTemplate(templateDir, targetDir, {
      name,
      frameworkVersionRange: FRAMEWORK_VERSION_RANGE,
      projectVersion: DEFAULT_PROJECT_VERSION,
    });
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
    console.log('  API 端点：');
    console.log(`    ${blue('GET')}  http://localhost:3000/`);
    console.log(`    ${blue('GET')}  http://localhost:3000/health`);
    console.log(`    ${blue('GET')}  http://localhost:3000/api/users`);
    console.log(`    ${blue('POST')} http://localhost:3000/api/users`);
    console.log(`    ${blue('GET')}  http://localhost:3000/api/users/:id`);
    console.log('');
  }

  console.log(`  文档: ${blue('https://github.com/Owl23007/nova-http')}`);
  console.log('');
}

interface TemplateVars {
  name: string;
  frameworkVersionRange: string;
  projectVersion: string;
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
        content = content.replace(/\{\{frameworkVersionRange\}\}/g, vars.frameworkVersionRange);
        content = content.replace(/\{\{projectVersion\}\}/g, vars.projectVersion);
        fs.writeFileSync(destPath, content, 'utf8');
      } else {
        fs.copyFileSync(srcPath, destPath);
      }

      log.step(destName);
    }
  }
}
