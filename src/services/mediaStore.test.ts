import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveMedia, fileOf, sweepOldMedia, removeWorkspaceMedia } from './mediaStore';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
process.env.MEDIA_PATH = dir;

test('saved files are found by id and refuse path tricks', () => {
  const m = saveMedia('ws1', Buffer.from('hello'), { kind: 'document', mime: 'application/pdf', name: 'a.pdf' });
  assert.ok(fs.existsSync(fileOf('ws1', m.id)!));
  assert.equal(fileOf('ws1', '../../etc/passwd'), null);
  assert.equal(fileOf('../x', m.id), null);
});

test('files past the retention period are removed, newer ones stay', () => {
  const old = saveMedia('ws2', Buffer.from('old'), { kind: 'image', mime: 'image/png', name: 'o' });
  const fresh = saveMedia('ws2', Buffer.from('new'), { kind: 'image', mime: 'image/png', name: 'n' });
  const longAgo = new Date(Date.now() - 100 * 86_400_000);
  fs.utimesSync(fileOf('ws2', old.id)!, longAgo, longAgo);
  assert.equal(sweepOldMedia(), 1);
  assert.ok(!fs.existsSync(fileOf('ws2', old.id)!));
  assert.ok(fs.existsSync(fileOf('ws2', fresh.id)!));
});

test('deleting a workspace removes its files', () => {
  const m = saveMedia('ws3', Buffer.from('x'), { kind: 'video', mime: 'video/mp4', name: 'v' });
  removeWorkspaceMedia('ws3');
  assert.ok(!fs.existsSync(fileOf('ws3', m.id)!));
});
