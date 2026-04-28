function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.length > 1 && uri.endsWith('/')) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: uri.slice(0, -1) } },
    };
  }

  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }

  if (/\.[a-z0-9]+$/i.test(uri)) {
    return request;
  }

  request.uri = uri + '/index.html';
  return request;
}
