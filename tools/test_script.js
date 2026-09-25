console.log("Testing complete");
require('child_process').execSync('node tests/test_booking_security.js', { stdio: 'inherit' });
