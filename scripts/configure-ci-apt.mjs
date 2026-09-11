import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// APT retries another listed mirror for an unavailable file and still verifies
// the Ubuntu archive signatures through the unchanged sources/keyring settings.
// https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-mirror.1.html
export const mirrorList =
  [
    'https://us.archive.ubuntu.com/ubuntu/\tpriority:1',
    'https://archive.ubuntu.com/ubuntu/\tpriority:2',
    'https://azure.archive.ubuntu.com/ubuntu/\tpriority:3',
  ].join('\n') + '\n';

export function withUbuntuMirrorFallback(source) {
  return source.replace(
    /https?:\/\/(?:(?:azure|us)\.)?archive\.ubuntu\.com\/ubuntu\/?(?=\s|$)/g,
    'mirror+file:/etc/apt/apt-mirrors.txt',
  );
}

export function configureCiApt(aptRoot) {
  const sourcePaths = [join(aptRoot, 'sources.list')];
  for (const name of readdirSync(join(aptRoot, 'sources.list.d'))) {
    if (name.endsWith('.sources') || name.endsWith('.list'))
      sourcePaths.push(join(aptRoot, 'sources.list.d', name));
  }
  for (const path of sourcePaths) {
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const next = withUbuntuMirrorFallback(source);
    if (next !== source) writeFileSync(path, next);
  }
  writeFileSync(join(aptRoot, 'apt-mirrors.txt'), mirrorList);
  writeFileSync(
    join(aptRoot, 'apt.conf.d/99ventureos-ci-network'),
    [
      'Acquire::Retries "1";',
      'Acquire::http::Timeout "10";',
      'Acquire::https::Timeout "10";',
      'Acquire::Languages "none";',
      'APT::Update::Error-Mode "any";',
      '',
    ].join('\n'),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (
    process.platform !== 'linux' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.getuid() !== 0
  )
    throw new Error('APT mirror setup is restricted to a root process on a Linux CI runner');
  configureCiApt('/etc/apt');
}
