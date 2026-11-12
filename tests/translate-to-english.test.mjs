import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Only the host's registration boundary is replaced. All prompt processing is real.
const registration = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@opencode/plugin') return {
      url: 'data:text/javascript,export const Plugin = {define: value => value}', shortCircuit: true,
    };
    return next(specifier, context);
  },
});
const sourceURL = new URL('../plugins/translate-to-english/index.ts', import.meta.url);
const definition = (await import(sourceURL.href)).default;
registration.deregister();

async function setup(generate, options = {}) {
  let hook;
  let model;
  await definition.setup({
    options,
    session: {
      hook(name, callback) { assert.equal(name, 'prompt'); hook = callback; },
      async create(input) {model=input.model; return {id:'translator-session'};},
      async generate(input, request) {
        assert.equal(input.sessionID,'translator-session');
        return generate({...input,model},request);
      },
      async remove(input) {assert.equal(input.sessionID,'translator-session');},
    },
  });
  return hook;
}

test('translates successive user prompts automatically using the configured model', async () => {
  const inputs = [];
  const hook = await setup(async input => { inputs.push(input); return {text: JSON.stringify({translation:'Fix the login bug.'})}; }, {model:'test/translator'});
  for (const text of ['Исправь вход', 'Проверь ещё раз', 'Corrige la connexion']) {
    const event = {prompt: {text}};
    await hook(event);
    assert.equal(event.prompt.text, 'Fix the login bug.');
  }
  assert.equal(inputs.length, 3);
  assert.deepEqual(inputs[0].model, {providerID:'test', id:'translator'});
});

test('uses an isolated configured session and removes it on success and failure', async () => {
  for (const succeeds of [true,false]) {
    let hook, removed=false;
    await definition.setup({options:{model:'litellm/deepseek-flash'},session:{
      hook(_name,callback){hook=callback;},
      async create(input){
        assert.equal(input.parentID,'working-session');
        assert.deepEqual(input.model,{providerID:'litellm',id:'deepseek-flash'});
        assert.deepEqual(input.permissions,[{action:'*',resource:'*',effect:'deny'}]);
        return {id:'temporary'};
      },
      async generate(input){
        assert.equal(input.sessionID,'temporary');
        if(!succeeds) throw Error('network unavailable');
        return {text:'{"translation":"Fix the bug."}'};
      },
      async remove(input){assert.equal(input.sessionID,'temporary');removed=true;},
    }});
    const pending=hook({sessionID:'working-session',prompt:{text:'Исправь ошибку.'}});
    if(succeeds) await pending; else await assert.rejects(pending,/Translation/);
    assert.equal(removed,true);
  }
});

test('accepts Cyrillic inside preserved paths and code', async () => {
  const hook = await setup(async () => ({text:JSON.stringify({translation:'Read `src/вход.ts` and fix the bug.'})}));
  const event = {prompt:{text:'Прочитай `src/вход.ts` и исправь ошибку.'}};
  await hook(event);
  assert.equal(event.prompt.text, 'Read `src/вход.ts` and fix the bug.');
});

test('translates mentions without dropping attachments or leaving stale offsets', async () => {
  const event = {prompt:{text:'Проверь @вход.ts', files:[{uri:'file:///src/вход.ts',mention:{start:8,end:16}}], agents:[{agent:'reviewer',mention:{start:0,end:7}}], skills:[{name:'review',mention:{start:0,end:7}}]}};
  await (await setup(async () => ({text:JSON.stringify({translation:'Review @вход.ts'})})))(event);
  assert.equal(event.prompt.text, 'Review @вход.ts');
  assert.deepEqual(event.prompt.files, [{uri:'file:///src/вход.ts'}]);
  assert.deepEqual(event.prompt.agents, [{agent:'reviewer'}]);
  assert.deepEqual(event.prompt.skills, [{name:'review'}]);
});

for (const [label, generate] of [
  ['provider failure', async () => {throw Error('provider unavailable');}],
  ['empty translation', async () => ({text:JSON.stringify({translation:'  '})})],
  ['invalid translation response', async () => ({text:'not JSON'})],
]) test(`blocks admission on ${label}, retaining the original draft`, async () => {
  const hook = await setup(generate);
  const event = {prompt:{text:'Исправь вход'}};
  await assert.rejects(hook(event), /[Tt]ranslat/);
  assert.equal(event.prompt.text, 'Исправь вход');
});

test('times out and aborts the translator request instead of sending the original', async () => {
  let signal;
  const hook = await setup((_input, request) => {signal=request?.signal; return new Promise(() => {});}, {timeoutMs:10});
  const event = {prompt:{text:'Исправь вход'}};
  await assert.rejects(hook(event), /[Tt]ranslat/);
  assert.equal(signal.aborted, true);
  assert.equal(event.prompt.text, 'Исправь вход');
});

test('does not translate attachment-only or whitespace-only prompts', async () => {
  const hook = await setup(async () => {throw Error('should not generate');});
  await hook({prompt:{files:[{uri:'file:///a.ts'}]}});
  await hook({prompt:{text:'  '}});
});
