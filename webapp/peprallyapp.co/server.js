// ExpressJS Server Setup
var express = require('express');
var app     = express();
var server  = require('http').Server(app);

// Other library includes
var fs = require('fs')
var io = require('socket.io')(server);
var bodyParser = require('body-parser');
var request = require('request');
var nodemailer = require('nodemailer');
var smtpTransport = require("nodemailer-smtp-transport")

//////////////////////////////////////////
// Serve static html for peprallyapp.co //
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
var keys = JSON.parse(fs.readFileSync('./config/keys.json', 'utf8'));

////////////////////////////
// Contact Me Email Route //
////////////////////////////
var transport = nodemailer.createTransport(smtpTransport({
  host: 'smtp.gmail.com',
  secureConnection: false, // use SSL
  port: 587, // port for secure SMTP
  auth: {
      user: keys.EMAIL_HOST,
      pass: keys.EMAIL_PW
  } 
}));

// Contact me email script
app.get('/send',function(req,res){
    var message = "Phone number: " + req.query.phone + "\nEmail: " + req.query.email + "\n\n" + req.query.message;
    var mailOptions={
      from: '"' + req.query.name + '" <' + req.query.email + '>',
        to: keys.EMAIL_HOST,
        subject: "peprallyapp.co Inquiry",
        text: message
    }
    console.log(mailOptions);
    transport.sendMail(mailOptions, function(error, response){
        if (error){
          console.log(error);
          res.end("error");
        } else {
          console.log("Message sent");
          res.end("sent");
        }
    });
});

//////////////////////////////
// Push Notification Routes //
//////////////////////////////

// Constants
// Firebase Keys
var API_ACCESS_KEY = keys.FIREBASE_API_ACCESS_KEY;
var FCM_URL = 'https://gcm-http.googleapis.com/gcm/send';

// Set the request headers
var headers = {
    'User-Agent'    : 'Super Agent/0.0.1',
    'Content-Type'  : 'application/json',
    'Authorization' : API_ACCESS_KEY
}

app.post('/post/like', function(req, res) {
  console.log(req.query);

  // Set the post data
  var post_data = {
  'data' : req.query,
    'to': req.query['receiver'] 
  };

  // Configure the POST request
  var options = {
      url: FCM_URL,
      method: 'POST',
      headers: headers,
      json: post_data
  }
  var statusCode;
  // Send the request to Google firebase
  request(options, function (error, res, body) {
    statusCode = res.statsCode;
    if (error) {
      console.log("ERROR: " + error);
    }
    else if (res.statusCode == 200) {
        createNewNotification(req.query);
    }
    console.log("status = " + statusCode);
  });

  var response = {
    status : statusCode
  };

  res.end(JSON.stringify(response));
});

/////////////////////////////
// DynamoDB Service Routes //
/////////////////////////////
// Load the AWS SDK for Node.js
var AWS = require('aws-sdk');
// Load credentials and set region from JSON file
AWS.config.loadFromPath('./config/config.json');

var AwsTablesEnum = {
  NOTIFICATIONS : "UserNotifications"
};

// Create DynamoDB service object
var ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
var docClient = new AWS.DynamoDB.DocumentClient();

function createNewNotification(json) {
  var params = {
    TableName: AwsTablesEnum.NOTIFICATIONS,
    Item: {
      "Username": json['receiver'],
      "FacebookIdSender": json['sender_fb_id'],
      "NotificationType": json['notification_type'],
      "senderUsername": json['sender'],
      "PostId": json['post_id'],
      "TimestampSeconds": Date.now()/1000
    }
  }

  docClient.put(params, function(err, data) {
    if (err) {
        console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
    }
  });
}

app.get('/test', function(req, res) {
  var params = {
    TableName: 'UserNotifications',
    KeyConditionExpression: 'Username = :n',
    ExpressionAttributeValues: {
      ':n' : {S: 'kev'}
    }
  };

  ddb.query(params, function(err, data) {
    if (err) {
      console.log("Error querying DDB: ", err);
    } else {
      data.Items.forEach(function(item) {
        console.log("time stamp: " + item.TimestampSeconds.N);
      });
    }
  });
});

app.get('/scan', function(req, res) {
  var params = {
    TableName: 'Usernames'
  };

  ddb.scan(params, function(err, data) {
    if (err) {
      console.log("Error scanning DDB: ", err);
    } else {
      data.Items.forEach(function(item) {
        console.log("Username: " + item.Username.S);
      });
    }
  });
  res.end('scanning db');
});

////////////////////////////////
// Socket.IO Messaging Routes //
////////////////////////////////
io.on('connection', function(socket){
  socket.on('chat message', function(msg){
    console.log('message: ' + msg);
    io.emit('chat message', msg);
  });

  // PepRally Socket Handlers
  socket.on('join_chat', function(jsonData){
    var jsonParsed = JSON.parse(jsonData.toString());
    var senderUsername = jsonParsed.sender_username;
    var receiverUsername = jsonParsed.receiver_username;
    console.log(senderUsername + ' joined the chat with ' + receiverUsername);

    // emitting to receiver
    io.emit("on_join_" + senderUsername, "callback_request");
  });

  // requesting call back for sender
  socket.on("callback_ack", function(jsonData){
    var jsonParsed = JSON.parse(jsonData.toString());
    var senderUsername = jsonParsed.sender_username;
    var receiverUsername = jsonParsed.receiver_username;
    console.log("got the callback from: " + senderUsername);
    io.emit("on_join_" + senderUsername); // not requesting callback here
  });

  socket.on('leave_chat', function(jsonData){
    var jsonParsed = JSON.parse(jsonData.toString());
    var senderUsername = jsonParsed.sender_username;
    var receiverUsername = jsonParsed.receiver_username;
    console.log(senderUsername + ' left the chat with ' + receiverUsername);

    // emitting to receiver
    io.emit("on_leave_" + senderUsername);
  });

  socket.on('send_message', function(jsonData){
    var jsonParsed = JSON.parse(jsonData.toString());
    var senderUsername = jsonParsed.sender_username;
    var receiverUsername = jsonParsed.receiver_username;
    // emitting to receiver
    io.emit("new_message_" + receiverUsername, senderUsername);
  });
});

/*
 * NOTE: Remember to manually re-route port 80 to 8080 on actual server using
 * sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to 8080
 */
server.listen(8080, function(){
  console.log('Starting server - listening on port :8080');
});
