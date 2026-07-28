console.log("1. 主线程开始");

setTimeout(() => {
  console.log("3. 异步回调触发（类比Java回调）");
}, 0);

console.log("2. 主线程不等待，直接执行到这里");
