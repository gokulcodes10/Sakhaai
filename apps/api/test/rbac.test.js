/**
 * RBAC unit tests. These guard the single most dangerous surface in the system:
 * if permissionSatisfies is ever wrong, every route guard is wrong with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  expandPermissions,
  permissionSatisfies,
  permissionSatisfiesAll,
  permissionSatisfiesAny,
} from '@sakha/shared';

test('exact permission match', () => {
  assert.equal(permissionSatisfies(['cms.content.publish'], 'cms.content.publish'), true);
  assert.equal(permissionSatisfies(['cms.content.write'], 'cms.content.publish'), false);
});

test('the global wildcard satisfies everything', () => {
  for (const p of ALL_PERMISSIONS) {
    assert.equal(permissionSatisfies(['*'], p), true, `* should satisfy ${p}`);
  }
});

test('domain wildcards do not leak across domains', () => {
  assert.equal(permissionSatisfies(['cms.*'], 'cms.content.publish'), true);
  assert.equal(permissionSatisfies(['cms.*'], 'cms.media.write'), true);
  // The important one: holding all of CMS must never imply holding IAM.
  assert.equal(permissionSatisfies(['cms.*'], 'iam.grant'), false);
  assert.equal(permissionSatisfies(['cms.*'], 'ops.settings.write'), false);
});

test('nested wildcards work at each level', () => {
  assert.equal(permissionSatisfies(['cms.content.*'], 'cms.content.publish'), true);
  assert.equal(permissionSatisfies(['cms.content.*'], 'cms.media.write'), false);
});

test('empty and malformed grants deny', () => {
  assert.equal(permissionSatisfies([], 'cms.access'), false);
  assert.equal(permissionSatisfies(null, 'cms.access'), false);
  assert.equal(permissionSatisfies(undefined, 'cms.access'), false);
  // A near-miss prefix must not match.
  assert.equal(permissionSatisfies(['cms'], 'cms.access'), false);
  assert.equal(permissionSatisfies(['cms.acces'], 'cms.access'), false);
});

test('all vs any', () => {
  const held = ['cms.access', 'cms.content.read'];
  assert.equal(permissionSatisfiesAll(held, ['cms.access', 'cms.content.read']), true);
  assert.equal(permissionSatisfiesAll(held, ['cms.access', 'cms.content.publish']), false);
  assert.equal(permissionSatisfiesAny(held, ['cms.content.publish', 'cms.access']), true);
  assert.equal(permissionSatisfiesAny(held, ['iam.grant']), false);
  // An empty requirement list is vacuously satisfied.
  assert.equal(permissionSatisfiesAll(held, []), true);
  assert.equal(permissionSatisfiesAny(held, []), true);
});

test('admins do not get CMS access by default', () => {
  // The brief requires the super admin to grant this deliberately, so it must
  // start off. If this test ever fails, that requirement has been broken.
  const admin = DEFAULT_ROLE_PERMISSIONS[SYSTEM_ROLES.ADMIN];
  assert.equal(permissionSatisfies(admin, 'cms.access'), false);
  assert.equal(permissionSatisfies(admin, 'cms.content.publish'), false);
});

test('admins cannot grant permissions by default', () => {
  const admin = DEFAULT_ROLE_PERMISSIONS[SYSTEM_ROLES.ADMIN];
  assert.equal(permissionSatisfies(admin, 'iam.grant'), false);
  assert.equal(permissionSatisfies(admin, 'iam.users.write'), false);
});

test('clients see only their own portal', () => {
  const client = DEFAULT_ROLE_PERMISSIONS[SYSTEM_ROLES.CLIENT];
  assert.equal(permissionSatisfies(client, 'portal.projects.read'), true);
  assert.equal(permissionSatisfies(client, 'crm.leads.read'), false);
  assert.equal(permissionSatisfies(client, 'sakha.conversations.read'), false);
  assert.equal(permissionSatisfies(client, 'cms.access'), false);
});

test('expandPermissions resolves wildcards for the grant UI', () => {
  assert.equal(expandPermissions(['*']).length, ALL_PERMISSIONS.length);
  const cms = expandPermissions(['cms.*']);
  assert.ok(cms.includes('cms.content.publish'));
  assert.ok(!cms.includes('iam.grant'));
  assert.deepEqual(expandPermissions(['cms.access']), ['cms.access']);
});
