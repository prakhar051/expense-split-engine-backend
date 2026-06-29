const fs = require('fs');
const path = require('path');

class FlakyTestReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
  }

  onRunComplete(contexts, results) {
    const flakyTests = [];

    for (const testSuite of results.testResults) {
      for (const testResult of testSuite.testResults) {
        // If a test passes but has more than 1 invocation, it failed first and then passed on retry -> FLAKY!
        const isFlaky = testResult.status === 'passed' && testResult.invocations > 1;
        if (isFlaky) {
          flakyTests.push({
            fullName: testResult.fullName,
            title: testResult.title,
            invocations: testResult.invocations
          });
        }
      }
    }

    // Write to unified reports folder
    const reportDir = path.resolve(__dirname, '../../../reports/jest');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(reportDir, 'flaky-tests.json'),
      JSON.stringify(flakyTests, null, 2)
    );
  }
}

module.exports = FlakyTestReporter;
