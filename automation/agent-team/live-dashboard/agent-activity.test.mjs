import test from 'node:test';import assert from 'node:assert/strict';import {agentActivity} from './agent-activity.mjs';
const now=Date.now(),event=(type,tool,threadId='owner')=>({type,tool,threadId,at:new Date(now).toISOString()});
test('owner waits for review while independent reviewer reads evidence',()=>{
 const events=[event('turn_started'),event('tool_started','request_review'),event('turn_started',null,'reviewer'),event('tool_started','read_observations','reviewer')];
 const owner=agentActivity({id:'owner',events,live:true,now}),reviewer=agentActivity({id:'reviewer',events,live:true,now});
 assert.equal(owner.status,'tool');assert.equal(owner.currentTool,'request_review');assert.equal(reviewer.currentTool,'read_observations');
 events.push(event('tool_completed','read_observations','reviewer'));assert.equal(agentActivity({id:'reviewer',events,live:true,now}).status,'thinking');
 events.push(event('turn_completed',null,'reviewer'));assert.equal(agentActivity({id:'reviewer',events,live:true,terminal:true,now}).status,'finished');
});
test('old, ended, retired and offline agents never animate as actively running',()=>{
 const events=[event('tool_started','calculate_scenario')];
 for(const [opts,expected] of [[{now:now+61000},'quiet'],[{live:false},'offline'],[{terminal:true},'finished'],[{retired:true},'retired']])assert.equal(agentActivity({id:'owner',events,live:true,now,...opts}).status,expected);
 assert.equal(agentActivity({id:'owner',events:[event('tool_call','read_observation')],live:true,now}).status,'idle');
});
