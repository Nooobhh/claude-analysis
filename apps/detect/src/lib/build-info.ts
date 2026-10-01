// 构建信息：页脚显示版本与 commit，让人核对线上跑的就是仓库里的代码。只在构建时（Node）运行
import { execSync } from 'node:child_process';
import pkg from '../../../../package.json';

const git = (args: string): string => {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
};

export const VERSION = pkg.version;
export const COMMIT = git('rev-parse HEAD');
/** 本地带着未提交的改动构建（正常发布走 CI，不会出现） */
export const DIRTY = COMMIT !== '' && git('status --porcelain') !== '';
