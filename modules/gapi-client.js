angular.module('gapi.client', []).provider('gapi', function() {
    var _authorization = {},
        _libraries = {};

    // pre configure libraries so they can be accessed by name using
    // gapi.load(name).then(...) rather than specifying this in the
    // controllers
    //
    // the following calls are synonymous:
    //
    // gapiProvider.library('myLibrary', {version: 'v1', url: '/_ah/api'});
    // gapiProvider.library('myLibrary', {version: 'v1', root: '/_ah/api'});
    // gapiProvider.library('myLibrary', 'v1', '/_ah/api');
    this.library = function(name, version, root) {
        if (typeof(version) === 'object') {
            root = version.url || version.root;
            version = version.version;
        }

        _libraries[name] = {version: version, root: root};
    }

    // pre configure $window.gapi.auth.authorize parameters
    this.authorization = function(options) {
        _authorization = options || {};
    }

    this.$get = ['$q', '$rootScope', '$window', function($q, $scope, $window) {
        var $gapi,
            _deferred = $q.defer(),
            _promise = _deferred.promise;

        function resolve() {
            if (!_deferred)
                throw new Error('Please call resolve on the deferred you ' +
                                'passed to ready earlier or pass the ' +
                                'deferred itself');

            $scope.$apply(function() { _deferred.resolve($gapi); });
        }

        $gapi = {
            // defaults for gapi.auth.authorize
            _authorization: _authorization,

            // a predefined list of libraries so you can just specify the
            // name below
            _libraries: _libraries,

            auth: {
                authorize: function(options) {
                    var deferred = $q.defer();
                    options = angular.extend({}, $gapi._authorization,
                                                 options || {});

                    $window.gapi.auth.authorize(options, function(response) {
                        if (response) deferred.resolve(response);
                        else deferred.reject(response);

                        $scope.$apply();
                    });

                    return deferred.promise;
                },

                init: function() {
                    var deferred = $q.defer();

                    $window.gapi.auth.init(function() {
                        deferred.resolve()
                        if (!$scope.$$phase) $scope.$apply();
                    });

                    return deferred.promise;
                }
            },

            // cache of clients like $window.gapi.client
            client: {},

            // converts methods on $window.gapi.client to support promises
            // and caches the results in gapi.client
            decorate: function(name) {
                var root = $window.gapi.client[name];

                return $gapi.client[name] = $gapi.decorateAll(root);
            },

            // recursively converts $window.gapi methods to support promises
            // starting at the given root
            decorateAll: function(root) {
                var k,
                    result = {},
                    v;

                for (k in root) {
                    if (root.hasOwnProperty(k)) {
                        v = root[k];

                        if (typeof(v) === 'object')
                            result[k] = $gapi.decorateAll(v);
                        else if (typeof(v) === 'function')
                            result[k] = $gapi.decorateMethod(v);
                        else
                            // preserve all other data
                            result[k] = v;
                    }
                }

                return result;
            },

            // converts a gapi method to a method with the same signature
            // which returns a promise rather than requiring a call to execute
            // with a callback
            decorateMethod: function(method) {
                return function() {
                    var deferred = $q.defer();

                    method.apply(this, arguments).execute(function(response) {
                        $scope.$apply(function() {
                            // is this too strong of an assumption?
                            if (response.error) deferred.reject(response);
                            else deferred.resolve(response);
                        });
                    });

                    return deferred.promise;
                };
            },

            // tries to load the api and returns a promise, if the api has
            // been loaded it resolves the cached copy unless
            // options.reload == true
            load: function(name, version, root, options) {
                if (!options) options = {};

                // if the library is already loaded and we didn't ask to
                // reload use that instance
                if ($gapi.client[name] && !options.reload) {
                    var deferred = $q.defer();
                    deferred.resolve($gapi.client[name]);

                    return deferred.promise;
                }

                if ($gapi._libraries[name] && !version) {
                    version = $gapi._libraries[name].version;
                    root = $gapi._libraries[name].root;
                }

                // load the client returning a promise
                // (successive calls are not batched with a promise)
                return _promise.then(function() {
                    var deferred = $q.defer();

                    $window.gapi.client.load(name, version, function() {
                        if (!$window.gapi.client[name]) deferred.reject();
                        else deferred.resolve($gapi.decorate(name));

                        $scope.$apply();
                    }, root);

                    return deferred.promise;
                });
            },

            mirror: function(name) {
                var method,
                    other = $window.gapi,
                    self = $gapi,
                    part,
                    parts = name.split('.'),
                    i = 0,
                    len = parts.length - 1;

                for (; i < len; i++) {
                    part = parts[i];
                    other = other[part];

                    if (self[part]) self = self[part];
                    else self = self[part] = {};
                }

                part = parts[len];
                method = other[part];

                self[part] = function() {
                    return method.apply(other, arguments);
                };

                return $gapi;
            },

            // if a callback is not given it is assumed that gapi onload
            // is not using a promise and the client has been loaded and
            // it is ready to continue
            //
            // otherwise the callback is converted to a promise on
            // $window.gapi being loaded modeled after $(document).ready
            ready: function(callback) {
                if (!callback) {
                    $gapi.mirror('auth.getToken')
                         .mirror('auth.setToken');

                    return resolve();
                }

                return _promise.then(callback);
            }
        };

        return $gapi;
    }];
});
