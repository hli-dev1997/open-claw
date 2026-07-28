// 模拟一个异步操作，比如调用LLM接口
function callLLM(prompt) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(`LLM回答了：${prompt}`);
    }, 100);
  });
}

// async/await写法，对比Java的CompletableFuture.get()
async function main() {
  console.log("1. 开始调用LLM");

  const result = await callLLM("今天天气怎么样");

  console.log("2. 拿到结果：" + result);
  console.log("3. 继续执行后续逻辑");
}

main();
//注意第4行比第2行先打印，说明await只是暂停了main()函数内部的执行，主线程没有被阻塞，继续往下跑了。
console.log("4. 这行在main()的await之前就打印了");
