/**
 * 错误契约（mission error-surface-contract）。
 *
 * 本文件把「错误面必须可被程序判定」钉成测试：
 *   I1 code 是契约、message 不是 —— 调用方只许判 `code`
 *   I2 message 自带上下文 —— 只看 message 必须能定位到具体对象
 *   I3 翻译不销毁证据 —— 原始错误必须进 `cause`
 *   I5 不泄漏引擎词汇 —— Cozo 的 `transact::*` 不得成为公开 `code`
 *
 * 外加一条**不变式**：`linkEntities` 重复同名边是刻意的 valid_time/tx_time 时间化
 * 再断言（边数不变、边历史累加），**不是 bug**。它最容易在重构中被"顺手修正"，
 * 故用测试守住。
 *
 * mission 载体：`.cdmt-lite/missions/active/error-surface-contract/attractors/error-contract.md`
 */
const { expect, test, describe } = require('bun:test');
const om = require('../cozo-om');
const { createTestDb } = require('./helpers');

// 注意：defineType / createEntity 接受裸 db；但 setProperty / linkEntities 会走
// 行为解析，需要带 registry 的 runtime（本仓库无进程级 registry，这是刻意的）。
async function seed() {
  const { db, runtime } = await createTestDb();
  await om.defineType(db, 'Thing', 'Thing');
  await om.defineType(db, 'Other', 'Other');
  await om.defineRelation(db, 'links', 'Thing', 'Other', true, 'links', {});
  await om.createEntity(db, 't1', 'Thing', 'first');
  await om.createEntity(db, 'o1', 'Other', 'other');
  return { db, runtime };
}

/** 捕获并返回抛出的错误；未抛则返回 null（让断言能给出清晰失败信息）。 */
async function capture(fn) {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
}

describe('error contract: data layer', () => {
  test('createEntity duplicate id throws EntityAlreadyExistsError with self-contained message', async () => {
    const { db } = await seed();
    const err = await capture(() => om.createEntity(db, 't1', 'Thing', 'dup'));

    expect(err).not.toBeNull();
    expect(err.code).toBe('ENTITY_ALREADY_EXISTS');
    expect(err.name).toBe('EntityAlreadyExistsError');

    // I2：message 必须自带上下文 —— 只看它就要能定位到具体实体与类型
    expect(err.message).toContain('t1');
    expect(err.message).toContain('Thing');

    // 结构化字段，调用方不必解析消息
    expect(err.entityId).toBe('t1');
    expect(err.typeName).toBe('Thing');

    // I3：原始错误被保留，排查信息不丢
    expect(err.cause).toBeTruthy();
  });

  test('the duplicate-id message no longer leaks the engine wording', async () => {
    const { db } = await seed();
    const err = await capture(() => om.createEntity(db, 't1', 'Thing', 'dup'));

    // 回归守卫：这正是本 mission 立项时的那条缺陷。
    // 改前 message === "when executing against relation 'om_entity'"，且 code 是
    // Cozo 私有的 'transact::assertion_failure'。两者都不许回来。
    expect(err.message).not.toContain('when executing against relation');
    expect(err.code).not.toBe('transact::assertion_failure');
    expect(err.code).not.toContain('transact::');
  });

  test('type / entity / relation not-found failures carry stable codes', async () => {
    const { db, runtime } = await seed();

    const typeErr = await capture(() => om.createEntity(db, 'z1', 'Nope', 'x'));
    expect(typeErr.code).toBe('TYPE_NOT_FOUND');
    expect(typeErr.typeName).toBe('Nope');

    const entityErr = await capture(() => om.setProperty(runtime, 'ghost', 'x', 1));
    expect(entityErr.code).toBe('ENTITY_NOT_FOUND');
    expect(entityErr.entityId).toBe('ghost');

    const relErr = await capture(() => om.linkEntities(runtime, 't1', 'no_such_rel', 'o1', {}));
    expect(relErr.code).toBe('RELATION_NOT_DEFINED');
    expect(relErr.relName).toBe('no_such_rel');

    // 链接到不存在的目标实体，也走同一个 ENTITY_NOT_FOUND 语义
    const targetErr = await capture(() => om.linkEntities(runtime, 't1', 'links', 'ghost', {}));
    expect(targetErr.code).toBe('ENTITY_NOT_FOUND');
  });

  test('every contract error is an Error and an OmError', async () => {
    const { db } = await seed();
    const err = await capture(() => om.createEntity(db, 't1', 'Thing', 'dup'));
    // instanceof 不能因为引入错误类而失效（调用方可能靠它做分支）
    expect(err instanceof Error).toBe(true);
    expect(err instanceof om.OmError).toBe(true);
    // 且不应误伤既有 behavior 错误类的继承链
    expect(err instanceof om.BehaviorUnresolvedError).toBe(false);
  });

  test('isAssertionFailure only keys off code, never off message', () => {
    // 它是「引擎词汇只作内部判据」的落点，若改成匹配 message，
    // 就等于把 Cozo 的措辞变成了契约。
    expect(om.isAssertionFailure({ code: 'transact::assertion_failure' })).toBe(true);
    expect(om.isAssertionFailure({ code: 'something_else' })).toBe(false);
    expect(om.isAssertionFailure({ message: 'transact::assertion_failure' })).toBe(false);
    expect(om.isAssertionFailure(null)).toBe(false);
    expect(om.isAssertionFailure(undefined)).toBe(false);
  });
});

describe('invariant: relinking is a time-scoped re-assertion, not an error', () => {
  test('relinking the same edge keeps one edge and accumulates history', async () => {
    const { runtime } = await seed();

    await om.linkEntities(runtime, 't1', 'links', 'o1', { tag: 'a' });
    // 第二次不应抛错 —— 这是刻意的 valid_time/tx_time 语义，不是待修的缺陷。
    await om.linkEntities(runtime, 't1', 'links', 'o1', { tag: 'b' });

    const neighbors = await om.getNeighbors(runtime, 't1', 'links', 'outgoing');
    expect((neighbors.outgoing || []).length).toBe(1);

    const history = await om.getEdgeHistory(runtime, 't1', 'links', 'o1');
    expect(history.length).toBe(2);
    expect(history.map((h) => h.props.tag)).toEqual(['a', 'b']);
  });
});
