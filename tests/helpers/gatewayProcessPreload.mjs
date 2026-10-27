// Explicit child-process fixture; not copied into the worker image.
import fs from 'node:fs';
import crypto from 'node:crypto';
import tls from 'node:tls';
import pg from 'pg';
import { SSMClient } from '@aws-sdk/client-ssm';
import runtimeStore from '../../dist/lib/apps/runtimeStore.js';
const fixture = JSON.parse(fs.readFileSync(process.env.SMARTDEPLOY_TEST_GATEWAY_FIXTURE, 'utf8'));
const originalConnect = tls.connect;
tls.connect = function (options) {
  if (!options || options.host !== fixture.row.privateIp) throw Error('Fixture refused a foreign workload route');
  return originalConnect({ ...options, host: '127.0.0.1' });
};
class FixturePool {
  on() {}
  async end() {}
  async query(sql, values) {
    if (!sql.includes('authenticate_app_gateway_credential') || values[0] !== fixture.row.credentialId
      || values[1] !== crypto.createHash('sha256').update(fixture.credential.split('.')[1]).digest('hex')) throw Error('Fixture refused unexpected SQL');
    return { rows: [{ bindingId: fixture.row.bindingId }] };
  }
}
pg.Pool = FixturePool;
SSMClient.prototype.send = async function (command) {
  if (command.input.Name !== fixture.row.credentialParameter || command.input.WithDecryption !== true) throw Error('Fixture refused unexpected SSM');
  return { Parameter: { Name: fixture.row.credentialParameter, ARN: fixture.parameterArn, Version: 1, Type: 'SecureString', Value: fixture.credential } };
};
runtimeStore.AppRuntimeStore.prototype.current = async function (appId, environment) {
  if (appId !== fixture.row.appId || environment !== fixture.row.environment) throw Error('Fixture refused unexpected scope');
  return { ...fixture.row, registeredAt: new Date(fixture.row.registeredAt) };
};
global.fetch = async function (input, init) {
  const url = new URL(input); const headers = new Headers(init.headers);
  if (url.origin !== 'https://control.test' || url.pathname !== '/api/gateway/documents' || headers.get('authorization') !== 'Bearer ' + fixture.credential
    || headers.get('x-smartdeploy-binding-id') !== fixture.row.bindingId || headers.has('cookie') || headers.has('origin')) throw Error('Fixture refused unexpected control transport');
  return Response.json({ document: null });
};
