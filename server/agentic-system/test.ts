import agent from "./agents/test/test.agent";

console.log('Running agent...');

const result = await agent.invoke({
  messages: [
    { role: 'user', content: "what's the weather in San Francisco?, and please calculate 3 + x, x come from weather in San Francisco, if sunny x means 3 unless x will be 1" }],
})

console.log('detail conversation', result.messages)

console.log('\nFinal answer:', result.messages.at(-1)?.content)
