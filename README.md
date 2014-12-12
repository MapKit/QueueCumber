QueueCumber
===========

QueueCumber is a little library that tries to prevent data loss due to connection problems. Whenever the server returns an error, QueueCumber will hold on to the request and retry it until it succeeds. QueueCumber is configurable per request however, so this behavior can be changed. It's designed to work with Backbone, and ties in to its `sync` method.

In modern browsers, stored requests will survive page refreshes because they are stored in localStorage.


First steps
-----------
QueueCumber needs to be instantiated in order to work. For our example, we'll create a global instance:

```javascript
var queueCumber = new QueueCumber();
```

Next, QueueCumber should be intergrated into Backbone. To do that, you'll have to override the `sync` method — this isn't done automatically. A very simple example would be:

```javascript
sync: function( method, model, options ) {
  options || (options = {});
  
  var params = {
    'type':     QueueCumber.methodMap[method],
    'dataType': 'json'
  };
  
  if( !options.url ) {
    params['url'] = _.result(model, 'url');
  }
  
  // Ensure that we have the appropriate request data.
  if(
    model && options.data == null &&
    (method === 'create' || method === 'update' || method === 'patch')
  ) {
    params['data'] = JSON.stringify(options.attrs || model.toJSON(options));
  }
  
  // `queueCumber` is a QueueCumber instance. 
  queueCumber.add(model, params, options);
}
```

With a `sync` method in place, we're done. You can now use Backbone like you normally would. All requests are routed throught QueueCumber, and if a non-GET request fails, it will retry until it succeeds.


Adding requests
---------------
The API has only one public method: `queueCumber.add(model, params, options)`:

* `model` is a Backbone model.
* `params` is normally created by Backbone's `sync` method. It can contain everything a normal jQuery `ajax` call accepts. Keep in mind that this object will be serialized, so adding callback functions won't work. QueueCumber will assure that some properties are always present:
```javascript
'type':        'GET',
'contentType': 'application/json',
'processData': false,
'url':         'http://url',
'data':        '{"json": true}',
'headers': {
  'X-First-Requested': parseInt(+new Date/1000),
  'X-Request-GUID':    guidString
}
```
* `options` is your usual Backbone options object. This object is not stored in localStorage, since it can contain non-scalar data (objects, functions). However, QueueCumber will store the `url` and `data` properties if you provide them.