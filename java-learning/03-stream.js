import { Readable } from 'stream';

// 模拟LLM的SSE流式输出，每隔50ms推一个token
function createFakeLLMStream() {
    const tokens = ['你', '好', '，', '今', '天', '天', '气', '晴', '朗', '你', '好', '，', '今', '天', '天', '气', '晴', '朗', '你', '好', '，', '今', '天', '天', '气', '晴', '朗'];
    let index = 0;

    return new Readable({
        objectMode: true,
        read() {
            if (index < tokens.length) {
                setTimeout(() => {
                    this.push(tokens[index++]);
                }, 50);
            } else {
                setTimeout(() => {
                    this.push(null);
                }, 50);
            }
        }
    });
}

async function main() {
    const stream = createFakeLLMStream();

    console.log('开始接收LLM流式输出：');

    for await (const token of stream) {
        process.stdout.write(token);
    }

    console.log('\n流结束');
}

main();