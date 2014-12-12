
// The queue reduces the risk of data loss by storing all requests
// in a memory queue. There are two memory pools for this: a persistent
// one, and a volatile one. In the volatile one, references to the
// actual object are stored, so events can be fired. The persistent
// one only has the actual request data. This storage is actually a
// fallback mechanic for when a request keeps failing during a session,
// and the user closes the browser.
// 
// Events
// ------
// add:      A request is added to the queue. Non-GET requests only.
// busy:     A request is picked up for processing. Doesn't fire for GET.
// success:  A request was completed successfully. Doesn't fire for GET.
// error:    Take a guess... But DOES fire for GET.
// removed:  When the user removes a request from the queue viewer.
(function( exports ) {
	var _localStorage;
	try {
		_localStorage = exports.localStorage;
		_localStorage.setItem('queuecumber', true);
		_localStorage.removeItem('queuecumber');
	} catch( e ) {
		_localStorage = {};
	}
	
	// Generate four random hex digits.
	function _S4() {
		return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
	}
	function _guid() {
		return _S4()+_S4()+"-"+_S4()+"-"+_S4()+"-"+_S4()+"-"+_S4()+_S4()+_S4();
	}
	
	var QueueCumber = exports.QueueCumber = function() {
		this._keyPrefix = 'queuecumber.';
		this._queue     = {};
		this._running   = false;
		
		// Upon load, set all requests to 'idle'. This way, previously
		// timed-out request will get processed again.
		// 
		// TODO: Make this more elegant. Simply setting everything to idle
		//       is probably not the way to go; other tabs can still be
		//       processing some of these requests.
		this.each(function( request ) {
			this._idle(request);
		}, this);
		
		this._run();
	}
	QueueCumber.methodMap = {
		'create': 'POST',
		'update': 'PUT',
		'patch':  'PATCH',
		'delete': 'DELETE',
		'read':   'GET'
	};
	
	_.extend(QueueCumber.prototype, Backbone.Events, {
		// Add a request to the queue.
		// The model is only used for triggering events.
		add: function( model, params, options ) {
			var request = this._createRequest(model, params, options);
			
			// This is the only place where new requests get added to
			// the in-memory queue.
			this._queue[request.guid] = request;
			// `_store` does NOT add data to the queue, it only mutates
			// existing entries.
			this._store(request);
			this.trigger('add', request, this);
			
			if( params['type'] == 'GET' ) {
				this._execute(request);
			} else {
				this._run();
			}
			
			return request;
		},
		
		get: function( guid ) {
			return this._queue[guid] || (
			         _localStorage[this._keyPrefix+guid] ? 
			         JSON.parse(_localStorage[this._keyPrefix+guid]) :
			         null
			       );
		},
		each: function( iterator, ctx ) {
			if( !iterator ) return;
			
			var key, guid
			  , prefixLength = this._keyPrefix.length
			  , queue = {};
			
			// Merge persistent and volatile GUIDs.
			for( key in _localStorage ) {
				guid = key.substr(prefixLength);
				if( key.substr(0,prefixLength) === this._keyPrefix )
					queue[guid] = 1;
			}
			for( guid in this._queue ) {
				if( _localStorage[this._keyPrefix+guid] ) {
					queue[guid] = 1;
				} else {
					// Request does not exist in the persistent queue, so it must have
					// been processed in another instance op MapKit. Remove it from the
					// volatile queue.
					delete this._queue[guid];
				}
			}
			
			var request;
			for( guid in queue ) {
				// If this is a browser, the request might already be processed and
				// removed in another tab.
				if( !(request = this.get(guid)) )
					continue;
				
				iterator.call(ctx || this, request, guid);
			}
		},
		countStatus: function( status ) {
			var count = 0;
			this.each(function( request ) {
				count += ~~(request['status'] === status);
			});
			return count;
		},
		
		reload: function( guid ) {
			var request = this.get(guid);
			if( request ) {
				request['next'] = 0;
				this._execute(request);
			}
		},
		remove: function( request ) {
			var guid;
			if( typeof request == 'string' ) {
				guid = request;
			} else if( request && typeof request.guid == 'string' ) {
				guid = request.guid;
			}
			
			// If the `request` param is an object, don't trust it:
			// get the request object from memory regardless.
			request = this.get(guid);
			
			if( !guid || !request ) {
				throw new Error('Could not find request');
			} else if( request['status'] == 'BUSY' ) {
				return;
			}
			
			delete this._queue[guid];
			delete _localStorage[this._keyPrefix+guid];
			
			this.trigger('removed', request, this);
		},
		
		_run: function( delay ) {
			var queue = this;
			
			// `_error()` uses this to ensure that `api._run()` is ran after
			// the delay for a failed request.
			if( delay ) {
				return setTimeout(function() {
					queue._run();
				}, delay);
			}
			
			// Loop through all request and try to process them
			if( !this._executeRequests() || this._running ) return;
			
			// If there are still requests in the queue, do another run in 2 sec
			// to see if all were cleared up.
			// ATTENTION
			// ---------
			// This cannot be simplified by combining this with the delay
			// functionality! Delays can go up to 5 minutes, which would mean
			// no queue rechecks would be done for 5 minutes.
			this._running = true;
			setTimeout(function(){
				queue._running = false;
				queue._run();
			}, 2000);
		},
		_executeRequests: function() {
			var executed = 0;
			this.each(function( request ) {
				if( this._execute(request) ) {
					executed++;
				}
			}, this);
			return executed;
		},
		// Execute a request using the request data provided. See `_add()` for a
		// definition of the `request` object. Returns true if the reqyest is a
		// valid request and was executed, or the request is to be tried later on.
		_execute: function( request ) {
			var queue   = this
			  , time    = +new Date
				, model   = request['model']
				, params  = request['params']
				, options = request['options'] || {}
				, success = options.success
				, error   = options.error;
			
			// Only process legal requests that are not being processed yet,
			// and are not set for a processing date in the future.
			if( params && request['status'] != 'BUSY' && time >= request['next'] ) {
				// Make the request, allowing the user to override the default parameters.
				this._busy(request);
			} else {
				// Stop request if the above requirements are not met.
				return false;
			}
			
			this.trigger('execute', request, this);
			this._ajax(model, params, _.extend({}, options, {
				success: function() {
					// Request succeeded, so it can be removed from the queue.
					success && success.apply(null, arguments);
					queue._success(request);
				},
				error: function( xhr ) {
					var resp;
					try {
						resp = JSON.parse(xhr.responseText);
					} catch(e) {
						resp = {'error': xhr.responseText};
					}
					request['lastResponse'] = resp;
					
					error && error.apply(null, arguments);
					queue._error(request);
					
					// TODO: If this is a MySQL error, freeze request for later?
					//       (will require manual control). Perhaps display an error
					//       dialog by default?
					// TODO: Sophistication? Include existing querystring/hash?
					if( resp && resp['logout'] )
						document.location.reload();
				}
			}));
			
			// Used in `_run`.
			return true;
		},
		// Gets called in `api.add()` and `_execute()`.
		_ajax: function( model, params, options ) {
			// Allows the user to override default parameters.
			options = options || {};
			params  = _.extend({}, params, options);
			
			options.xhr = Backbone.ajax(params);
			model && model.trigger('request', model, options.xhr, options);
		},
		
		// Mutating the queue and requests
		// -------------------------------
		_createRequest: function( model, params, options ) {
			var guid = _guid();
			
			options = _.defaults(options || {}, {
				title:       '',
				description: '',
			});
			
			// Make sure some important param fields have sensible
			// defaults/values.
			params = _.defaults(params || {}, {
				'type':        'GET',
				'contentType': 'application/json',
				'processData': false,
				'url':         options.url,
				'data':        options.data
			});
			params['headers'] = _.extend(params['headers'] || {}, {
				'X-First-Requested':	parseInt(+new Date/1000),
				'X-Request-GUID':			guid
			});
			
			return {
				// Essentials.
				'guid':         guid,
				'params':       params,
				'options':      options,
				'model':        model,
				
				'status':       'IDLE',
				// The `last`, `next`, `tries`, `maxRetries` properties are helper
				// information for when a request fails.
				'last':         +new Date,
				'next':         0,
				'tries':        0,
				'maxRetries':   options.maxRetries || params['maxRetries'],
				
				// In case of an error, this will store the last response.
				// Like: {'error': 'message'}.
				'lastResponse': null,
				
				// If this request exceeded its maxRetries, it will be removed from
				// the queue, and this property will be set to true.
				// TODO: This is useless now since the request is immediately removed
				//       afterwards. Remove this functionality, or do something with
				//       it (like sending the request data along in the `error` event).
				'removed':      false,
				
				// TODO: Remove these two here, since they're also in options?
				'title':        options.title,
				'description':  options.description
			};
		},
		_store: function( request ) {
			if( !request || typeof request.guid != 'string' ) {
				throw new Error('Expected request object');
			}
			
			var guid = request.guid;
			
			// Store in volatile queue if GUID exists. If not, this could
			// be a request from another tab, or another session. In this
			// case we don't want this request to be in this instance's memory.
			// 
			// Adding new request to the in-memoory queue happens in `add`.
			if( guid in this._queue )
				this._queue[guid] = request;
			
			// Remove elements that cannot be serialized.
			request = _.extend({}, request);
			delete request['options'];
			delete request['model'];
			
			// Store in persistent queue.
			try {
				_localStorage[this._keyPrefix+guid] = JSON.stringify(request);
			} catch( e ) {
				throw new Error('Could not store request in localStorage');
			}
		},
		// Set a request to 'busy'.
		// TODO: Remove requests that have been tried > x times? Display error?
		_busy: function( request ) {
			request['status'] = 'BUSY';
			request['last']   = +new Date;
			request['next']   = 0;
			this._store(request);
			
			this.trigger('busy', request, this);
		},
		// Request failed. Set back to 'idle', increase `tries`, update `last`.
		_error: function( request ) {
			request['status'] = 'ERROR';
			request['last']   = +new Date;
			request['tries']++;
			
			// Determine what to do with requests that have previously failed.
			var delay = request['tries'] == 1  &&     1000 ||
			            request['tries'] <  4  &&     4000 ||
			            request['tries'] >= 4  &&
			            request['tries'] <  10 &&    60000 ||
			            request['tries'] >= 10 &&   300000
			request['next'] = request['last'] + delay;
			
			// If maxRetries is exhausted, remove the request.
			if(
				request['maxRetries'] >= 0 &&
				request['tries'] > request['maxRetries']
			) {
				request['removed'] = true;
				this._store(request);
				this.remove(request);
			} else {
				this._store(request);
				this._run(delay);
			}
			
			this.trigger('error', request, this);
		},
		// Set a request back to 'idle'.
		_idle: function( request ) {
			request['status'] = 'IDLE';
			request['next']   = 0;
			this._store(request);
		},
		// Request is successfully completed. This status update is only
		// relevant for the event propagation.
		_success: function( request ) {
			request['status'] = 'SUCCESS';
			this._store(request);
			this.trigger('success', request, this);
			this.remove(request);
		}
	});
})(typeof exports == 'object' ? exports : this);