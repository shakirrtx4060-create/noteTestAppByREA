// Builds dist/NoteNest-win32-x64 from the local Electron runtime.
// (Used instead of electron-packager, whose zip extraction stalls on Node 26.)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'dist', 'NoteNest-win32-x64');
const appDir = path.join(out, 'resources', 'app');

(async () => {
  const { load } = await import('resedit/cjs').catch(() => ({ load: null }));
  const ResEdit = load ? await load() : require('resedit');

  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(electronDist, out, { recursive: true });
  fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });
  fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'NoteNest.exe'));

  // App files only; dev tooling and node_modules are not needed at runtime.
  for (const item of ['main.js', 'preload.js', 'renderer', 'assets']) {
    fs.cpSync(path.join(root, item), path.join(appDir, item), { recursive: true });
  }
  const { devDependencies, scripts, allowScripts, ...runtimePkg } = pkg;
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(runtimePkg, null, 2));

  // Set the exe icon and version info.
  const exePath = path.join(out, 'NoteNest.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'assets', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map((i) => i.data));
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const langs = vi.getAllLanguagesForStringValues();
    for (const l of langs) {
      vi.setStringValues(l, {
        FileDescription: pkg.productName,
        ProductName: pkg.productName,
        InternalName: pkg.productName,
        OriginalFilename: 'NoteNest.exe',
        CompanyName: '',
      });
    }
    vi.setFileVersion(...pkg.version.split('.').map(Number), 0);
    vi.setProductVersion(...pkg.version.split('.').map(Number), 0);
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('Built', out);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
