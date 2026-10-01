const serverless = require('serverless-http');
const app = require('../../server');

const handler = serverless(app, {
  binary: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
    'application/zip',
    'application/pdf',
    'audio/*'
  ]
});

module.exports.handler = async (event, context) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }
  return handler(event, context);
};

