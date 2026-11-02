// Stop only this checkout's cooperative demo before clean/build; active work is left intact.
const { stopPreviousDemo } = require('../demo/lifecycle.cjs');

stopPreviousDemo()
  .then((stopped) => {
    if (stopped) console.log('Previous Snapora Demo exited; native files released.');
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
