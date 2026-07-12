import nodePath from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import './raw-jsonc-loader.mjs';

const hookHandler = (hook) => (typeof hook === 'function' ? hook : hook?.handler);

const flattenPlugins = (plugins) =>
  plugins.flatMap((plugin) => (Array.isArray(plugin) ? flattenPlugins(plugin) : plugin ? [plugin] : []));

const importProjectModule = (projectRequire, specifier) =>
  import(pathToFileURL(projectRequire.resolve(specifier)));

const importAstroInternal = (projectRequire, relativePath) => {
  const astroPackage = projectRequire.resolve('astro/package.json');
  return import(new URL(relativePath, pathToFileURL(astroPackage)));
};

export async function createCloudflareMdxTransform({ projectRoot, fixedNow }) {
  if (process.cwd() !== projectRoot) {
    throw new Error(`Cloudflare MDX workers must inherit cwd ${projectRoot}; got ${process.cwd()}`);
  }
  installFixedDate(fixedNow);

  const projectRequire = createRequire(pathToFileURL(nodePath.join(projectRoot, 'package.json')));
  const [{ register }, { validateConfig }, { createSettings }, { loadOrCreateNodeLogger }, hooks] =
    await Promise.all([
      importProjectModule(projectRequire, 'tsx/esm/api'),
      importProjectModule(projectRequire, 'astro/config'),
      importAstroInternal(projectRequire, './dist/core/config/settings.js'),
      importAstroInternal(projectRequire, './dist/core/logger/load.js'),
      importAstroInternal(projectRequire, './dist/integrations/hooks.js'),
    ]);
  register();
  const userConfig = (
    await import(pathToFileURL(nodePath.join(projectRoot, 'astro.config.ts')).href)
  ).default;
  const astroConfig = await validateConfig(userConfig, projectRoot, 'build');
  const logger = await loadOrCreateNodeLogger(astroConfig, { logLevel: 'silent' });
  let settings = await createSettings(astroConfig, 'silent', projectRoot);
  settings = await hooks.runHookConfigSetup({ settings, command: 'build', logger });
  await hooks.runHookConfigDone({ settings, command: 'build', logger });

  const plugins = flattenPlugins(settings.config.vite.plugins ?? []);
  const compilePlugin = plugins.find((plugin) => plugin.name === '@mdx-js/rollup');
  const postprocessPlugin = plugins.find((plugin) => plugin.name === '@astrojs/mdx-postprocess');
  const compile = hookHandler(compilePlugin?.transform);
  const postprocess = hookHandler(postprocessPlugin?.transform);
  if (!compile || !postprocess) {
    throw new Error(
      `Expected initialized Astro MDX plugins; found ${plugins.map(({ name }) => name).join(', ')}`,
    );
  }
  await compilePlugin.configResolved?.({ build: { sourcemap: false }, plugins });

  return {
    async transform(code, id) {
      const compiled = await compile.call({}, code, id);
      if (!compiled || typeof compiled.code !== 'string') {
        throw new Error(`Astro MDX compiler returned no code for ${id}`);
      }
      const postprocessed = await postprocess.call(
        { environment: { name: 'prerender' } },
        compiled.code,
        id,
      );
      return {
        ...compiled,
        code: postprocessed?.code ?? compiled.code,
        map: compiled.map ?? null,
      };
    },
    buildEnd() {
      return compilePlugin.buildEnd?.();
    },
  };
}

function installFixedDate(fixedNow) {
  if (!fixedNow) return;
  const installedKey = Symbol.for('rolldown-cloudflare-mdx-fixed-date');
  if (globalThis[installedKey]) {
    if (globalThis[installedKey] !== fixedNow) {
      throw new Error(`A different fixed Date is already installed: ${globalThis[installedKey]}`);
    }
    return;
  }
  const NativeDate = globalThis.Date;
  const fixedTime = NativeDate.parse(fixedNow);
  if (!Number.isFinite(fixedTime)) throw new Error(`Invalid fixedNow value: ${fixedNow}`);
  function FixedDate(...args) {
    if (!new.target) return new NativeDate(fixedTime).toString();
    return Reflect.construct(NativeDate, args.length === 0 ? [fixedTime] : args, new.target);
  }
  Object.setPrototypeOf(FixedDate, NativeDate);
  FixedDate.prototype = NativeDate.prototype;
  FixedDate.now = () => fixedTime;
  globalThis.Date = FixedDate;
  globalThis[installedKey] = fixedNow;
}
