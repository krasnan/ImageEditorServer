const API_ENDPOINT = process.env.npm_package_config_api_endpoint || "http://wiki.matfyz.sk/api.php";
const API_TOKEN = process.env.npm_package_config_api_token || "";
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";


// Setup basic express server
const request = require('request');
const md5 = require('md5');
const server = require('http').createServer();
const io = require('socket.io')(server);

server.listen(PORT, HOST);
console.log('> Listening on: ' + HOST + ':' + PORT);
console.log('> Runing with API_ENDPOINT: ' + API_ENDPOINT);


let rm = new RoomManager();

io.on('connection', function (socket) {
    let query = socket.handshake.query;
    let user = new User(query['name'], socket);
    user.setToken(query['secret']);

    if (user.verified) { //TODO: authenticate user... Check the wiki edit token with api.

        let room = rm.createRoom(query['file']);

        socket.join(room.name);

        // socket.emit('connection-created', {room: room, user: user});
        room.createUser(user, socket);

        socket.on('message-created', function (message) {
            room.createMessage(message.text, user.id, '*');
        });

        socket.on('canvas-modified', function (properties) {
            room.modifyCanvas(properties, socket);
        });

        socket.on('selection-changed', function (data) {
            room.setSelectable(data.id, data.selectable, user, socket);
        });

        socket.on('object-modified', function (object) {
            room.modifyObject(object, socket);
        });

        socket.on('object-created', function (object) {
            room.createObject(object, socket);
        });

        socket.on('object-removed', function (id) {
            room.removeObject(id, socket);
        });

        socket.on('disconnect', function () {
            room.deselectObjectsBy(user);

            socket.broadcast.to(room.name).emit('user-removed', user);
            socket.leave(room.name);
            room.removeUser(socket.id);
        });
    }
    else{
        console.log(" ! Bad token")
    }


});


function User(name, socket) {
    let self = this;

    this.id = socket.id;
    this.name = name;
    this.color = getRandomColor();
    this.verified = false;

    this.getSocket = function () {
        return io.sockets.connected[this.id];
    };

    this.setToken = function (token) {
        _token = token;
        this.verifyUser(_token);
    };

    this.getToken = function () {
        return _token;
    };

    this.verifyUser = function (token) {
        console.log(token + "  |  " + md5(API_TOKEN));
        self.verified = token === md5(API_TOKEN);
        return self.verified;
        // request.post(
        //     {
        //         url: API_ENDPOINT,
        //         form: {
        //             action: 'checktoken',
        //             format: 'json',
        //             type: 'csrf',
        //             maxtokenage: 999999,
        //             token: encodeURI(token)
        //         }
        //     },
        //     function (error, response, body) {
        //         if (error) {
        //             console.log("Unable to connect to: " + API_ENDPOINT);
        //             console.log(error);
        //             self.verified = false;
        //         }
        //         body = JSON.parse(body);
        //         self.verified = (body.checktoken && body.checktoken.result !== "invalid");
        //         console.log(self.verified);
        //     }
        // );
    }
}

function Message(text, from, to, type) {
    this.from = from;
    this.to = to;
    this.text = text;
    this.type = type;
    dt = new Date();
    this.time = dt.toLocaleTimeString();
}

function Room(file) {
    let self = this;
    this.users = {};
    this.messages = [];
    this.objects = {};
    this.canvas = {width: 1280, height: 720};
    this.format = "png";
    this.loaded = false;
    this.file = file;

    this.name = this.file;

    this.isEmpty = function () {
        return Object.keys(this.users).length <= 0;
    };

    this.loadFromWiki = function () {
        request.post(
            {
                url: API_ENDPOINT,
                form: {
                    action: 'query',
                    format: 'json',
                    prop: 'imageinfo',
                    titles: this.file,
                    iiprop: 'url|dimensions|metadata|mime'
                }
            },
            function (error, response, body) {
                if (error) {
                    console.log("Unable to connect to: " + API_ENDPOINT);
                    console.log(error);
                    return;
                }
                body = JSON.parse(body);

                let pageId = Object.keys(body.query.pages)[0];
                if (pageId >= 0) {
                    let imageinfo = body.query.pages[pageId].imageinfo[0];
                    self.canvas.width = imageinfo.width;
                    self.canvas.height = imageinfo.height;
                    self.format = imageinfo.mime.split('/')[1];

                    let jsonLoaded = false;

                    for (let i in imageinfo.metadata) {
                        if (imageinfo.metadata.hasOwnProperty(i)) {
                            if (imageinfo.metadata[i].name === 'imageEditorContent') {
                                try{
                                    let content = JSON.parse(imageinfo.metadata[i].value);
                                    content.objects.forEach(function (obj) {
                                        self.objects[obj.id] = obj;
                                    });

                                    if (content.background !== undefined)
                                        self.canvas.backgroundColor = content.background;

                                    jsonLoaded = true;
                                }
                                catch (ex){
                                }
                            }
                        }
                    }
                    if (!jsonLoaded) {
                        self.loadObjectImageFromUrl(imageinfo.url);
                    }
                    self.deselectAll();

                }
                self.loaded = true;
                io.in(self.name).emit('init', {
                    room: self
                });
            }
        );
    };

    this.createUser = function (user, socket) {
        this.users[user.id] = user;
        console.log("+ user " + user.name + "(" + user.id + ") added");
        this.createMessage('User ' + user.name + ' connected', 'SYSTEM', '*', 'system');
        io.in(this.name).emit('user-created', this.users[user.id]);

        socket.emit('connected', user);

        if (this.loaded) {
            socket.emit('init', {
                room: this,
            });
        }
    };

    this.removeUser = function (id) {
        if (this.users[id] === undefined) return;

        this.createMessage('User ' + this.users[id].name + ' disconnected', 'SYSTEM', '*', 'system');
        io.in(this.name).emit('user-removed', id);

        delete this.users[id];
        console.log("- user " + id + " deleted");

        if (this.isEmpty())
            rm.removeRoom(this.name);
    };

    this.createMessage = function (text, from, to, type) {
        let message = new Message(text, from, to, type);
        this.messages.push(message);
        io.in(this.name).emit('message-created', message);
        // socket.broadcast.to(this.name).emit('message-created', message);
    };

    this.modifyCanvas = function (properties, socket) {
        this.canvas.height = properties.height;
        this.canvas.width = properties.width;
        this.canvas.backgroundColor = properties.backgroundColor;
        socket.broadcast.to(this.name).emit('canvas-modified', this.canvas);
    };

    this.createObject = function (obj, socket) {
        this.objects[obj.id] = obj;
        socket.broadcast.to(this.name).emit('object-created', this.objects[obj.id]);
    };

    this.loadObjectImageFromUrl = function (url) {
        this.objects['loaded_image'] = {
            id: 'loaded_image',
            type: 'image',
            name: this.file,
            src: url,
            left: 0,
            top: 0,
            width: this.canvas.width,
            height: this.canvas.height,
            index: 0
        }
    };

    this.removeObject = function (id, socket) {
        delete this.objects[id];
        socket.broadcast.to(this.name).emit('object-removed', id);
    };

    this.modifyObject = function (obj, socket) {
        obj.selectable = this.isSelectable(obj.id);
        obj.selectedBy = this.getSelectedBy(obj.id);
        this.objects[obj.id] = obj;
        socket.broadcast.to(this.name).emit('object-modified', this.objects[obj.id]);
    };


    this.isSelectable = function (id) {
        if (this.objects[id] === undefined) {
            return false;
        }
        return this.objects[id].selectable;
    };
    this.getSelectedBy = function (id) {
        if (this.objects[id] === undefined) {
            return undefined;
        }
        return this.objects[id].selectedBy;
    };
    this.deselectObjectsBy = function (user) {
        for (let id in this.objects) {
            let unselected = this.deselectObject(id, user);
            console.log("> unlocking object id: " + id + " user: " + user.id + " unselected: " + unselected);
            if (unselected) {
                io.in(this.name).emit('selection-changed', {id: id, selectable: this.isSelectable(id)});
            }
        }
    };
    this.deselectObject = function (id, user) {
        if (this.getSelectedBy(id) !== user.id) {
            return false;
        }
        else {
            this.objects[id].selectable = true;
            this.objects[id].selectedBy = undefined;

            return true;
        }
    };
    this.selectObject = function (id, user) {
        if (!this.isSelectable(id)) {
            return false;
        }
        else {
            this.objects[id].selectable = false;
            this.objects[id].selectedBy = user.id;
            return true;
        }
    };
    this.setSelectable = function (id, selectable, user, socket) {
        // console.log('selection-changed: ', id, selectable, user);
        // console.log(this.objects);
        let result = false;
        if (selectable)
            result = this.deselectObject(id, user);
        else
            result = this.selectObject(id, user);

        if (result)
            socket.broadcast.to(this.name).emit('selection-changed', {
                id: id,
                selectable: selectable,
                selectedBy: user.id
            });
        else
            socket.emit('selection-deny', id);
    };
    this.deselectAll = function () {
        for (let id in this.objects) {
            this.objects[id].selectable = true;
            this.objects[id].selectedBy = undefined;
        }
    }
}

function RoomManager() {
    this.rooms = [];

    this.isEmpty = function () {
        return Object.keys(this.rooms).length <= 0;
    };

    this.getRoom = function (file) {
        return this.rooms[file];
    };

    this.createRoom = function (file) {
        let room = this.getRoom(file);
        if (room === undefined) {
            room = new Room(file);
            this.rooms[room.name] = room;

            console.log("+ room " + room.name + " added");
            room.loadFromWiki();
        }
        return room;
    };

    this.removeRoom = function (name) {
        delete this.rooms[name];
        console.log("- room " + name + " deleted");
    };
}


function getRandomColor() {
    let letters = '0123456789ABCDE'.split('');
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.round(Math.random() * 14)];
    }
    return color;
}

Array.prototype.move = function (from, to) {
    this.splice(to, 0, this.splice(from, 1)[0]);
};