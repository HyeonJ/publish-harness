# Windows command policy

Windows PowerShell can resolve `npm`/`npx` through PowerShell shims such as
`npm.ps1` and `npx.ps1`. In some environments those files may open in an editor
when launched through `Start-Process`.

## Required Rule

When running commands from Windows PowerShell, call the `.cmd` launchers
explicitly:

```powershell
npm.cmd install
npm.cmd run dev
npx.cmd playwright install chromium
```

For background processes, use:

```powershell
Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WindowStyle Hidden
```

Do not use:

```powershell
Start-Process -FilePath "npm" -ArgumentList "run", "dev"
Start-Process -FilePath "npx" -ArgumentList "..."
```

## Shell Guidance

- PowerShell: use `npm.cmd` and `npx.cmd`.
- cmd.exe: `npm` and `npx` are usually fine, but `npm.cmd`/`npx.cmd` are also
  valid.
- Git Bash / WSL / macOS / Linux: use `npm` and `npx`.
- Bash scripts in this harness may continue to use `npm`/`npx`; the `.ps1`
  issue is specific to PowerShell process launching.
