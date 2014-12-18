QueueCumber
===========

[![Gitter](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/MapKit/QueueCumber?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

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
The API method to add a request to the queue is `queueCumber.add(model, params, options)`:

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
  `X-First-Requested` is set when the request is first made. This way the server you can implement backend logic that can put incoming requests in the proper order, since it's possible they won't arrive in chronological order. See the chapter **Backend requirements**.
  
  `X-Request-GUID` is a [GUID](http://en.wikipedia.org/wiki/Globally_unique_identifier) which is used in QueueCumber to uniquely identify a request. It's also sent to the server, so you can implement something in your backend that prevents replaying of requests.
* `options` is your usual Backbone options object. This object is not stored in localStorage, since it can contain non-scalar data (objects, functions). However, a few options will be picked up by QueueCumber, and permanently stored in the request:
```javascript
'url':        url,
'data':       '{"json":true}',
'maxRetries': 3
```


Anatomy of a request
--------------------
Every time a request is added to QueueCumber, it will create a *request object*. This is a plain JavaScript object:

```javascript
{
  'guid':         guid,
  'params':       params,
  'options':      options,
  'model':        model,
  
  // Current request state.
  'status':       'IDLE',
  'last':         +new Date,
  'next':         0,
  'tries':        0,
  'maxRetries':   options.maxRetries || params['maxRetries'],

  // In case of an error, this will store the last response.
  // Like: {'error': 'message'}.
  'lastResponse': null,

  // If this request exceeded its maxRetries, it will be removed from
  // the queue, and this property will be set to true. Although removed
  // from the queue, this property can be checked for in the `error` event.
  'removed':      false,

  'title':        options.title,
  'description':  options.description
}
```


Catalog of events
-----------------
QueueCumber uses Backbone's event system, so you can keep tabs on what's happening from the outside. To listen to events, you can use the familiar Backbone API methods.

This is a list of all events. Every request has two arguments: `request`, a request object as described above, and `queue`, which is a QueueCumber instance.

* **"add"** (request, queue) — A request is added to the queue. Non-GET requests only.
* **"busy"** (request, queue) — A request is picked up for processing. Doesn't fire for GET.
* **"success"** (request, queue) — A request was completed successfully. Doesn't fire for GET.
* **"error"** (request, queue) — The server returned an error. DOES fire for GET.
* **"removed"** (request, queue) — When a request is removed from the queue. This can happen manually, or because the amount of retries has reached `maxRetries`.


Backend requirements
--------------------
To get started with QueueCumber is very easy, but to get it working correctly all the time will require some backend work. QueueCumber can't provide in this because every situation requires its own specific solution.

#### Asynchronicity
The most important issue is asynchronicity: in case of bad connections or server problems, requests don't necessarily arrive in synchronous order. In some cases the backend will need to account for this, or data will be stored the wrong way. For this, QueueCumber sends a `X-First-Requested` header along with every request it makes. This header holds a UNIX timestamp indicating when the request was first tried.

#### Double requests
The other issue is double requests. In some very specific situations where multiple tabs are opened it's possible that one request gets sent out multiple times. Although it's very unusual, and it will probably be fixed later on, it is possible and should be accounted for. QueueCumber send along a `X-Request-GUID` header containing a unique [GUID](http://en.wikipedia.org/wiki/Globally_unique_identifier), so every request can be uniquely identified on the server.