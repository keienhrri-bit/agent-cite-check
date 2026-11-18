// Resolve the open object itself. Repeating realpath on its old name could
// validate a different object after a parent directory was replaced.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const macPath = 'my $p = "\\0" x 1024; defined fcntl(STDIN, 50, $p) or die $!; $p =~ s/\\0.*//s; print $p';

// Query the inherited standard-input handle, without interpolating report data.
const winPath = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FileLocation {
    [DllImport("msvcrt.dll")]
    public static extern IntPtr _get_osfhandle(int fd);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetFinalPathNameByHandle(IntPtr file, StringBuilder path, uint length, uint flags);
}
'@
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$buffer = New-Object Text.StringBuilder 32768
for ($i = 0; $i -lt [int]$env:ACC_DESCRIPTOR_COUNT; $i++) {
    $handle = [FileLocation]::_get_osfhandle(3 + $i)
    $length = [FileLocation]::GetFinalPathNameByHandle($handle, $buffer, $buffer.Capacity, 0)
    if (!$length -or $length -ge $buffer.Capacity) { exit 1 }
    $name = $buffer.ToString()
    if (!$name.StartsWith('\\?\') -or $name.StartsWith('\\?\UNC\')) { exit 1 }
    [Console]::Write($name.Substring(4) + [char]0)
}
`;

export function descriptorPaths(fds) {
  if (process.platform === 'win32') {
    const shell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = Buffer.from(winPath, 'utf16le').toString('base64');
    const result = execFileSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', script], {
      stdio: ['ignore', 'pipe', 'pipe', ...fds], env: { ...process.env, ACC_DESCRIPTOR_COUNT: String(fds.length) },
      encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024,
    });
    return result.split('\0').slice(0, -1);
  }
  if (process.platform === 'darwin') {
    return fds.map(fd => execFileSync('/usr/bin/perl', ['-e', macPath], {
      stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000,
    }));
  }
  return fds.map(fd => fs.readlinkSync('/proc/self/fd/' + fd));
}
