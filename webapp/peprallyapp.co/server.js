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
var unmarshalItem = require('dynamodb-marshaler').unmarshalItem;

//////////////////////////////////////////
// Serve static html for peprallyapp.co //
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

///////////////////////////////
// Contact Me Email Endpoint //
///////////////////////////////
var keys = JSON.parse(fs.readFileSync('./config/keys.json', 'utf8'));

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

// Firebase Constants
var API_ACCESS_KEY = keys.FIREBASE_API_ACCESS_KEY;
var FCM_URL = 'https://gcm-http.googleapis.com/gcm/send';

// Set the request headers
var headers = {
    'User-Agent'    : 'Super Agent/0.0.1',
    'Content-Type'  : 'application/json',
    'Authorization' : API_ACCESS_KEY
}

////////////////////
// Service Routes //
////////////////////

// Load the AWS SDK for Node.js
var AWS = require('aws-sdk');
// Load credentials and set region from JSON file
AWS.config.loadFromPath('./config/config.json');

var AwsTablesEnum = {
  NOTIFICATIONS : "UserNotifications",
  USERNAMES : "Usernames",
  USER_PROFILES: "user_profiles",
  PLAYER_PROFILES: "PlayerProfiles_UTAustin",
  USER_POSTS : "UserPosts"
};

// Create DynamoDB service object
var docClient = new AWS.DynamoDB.DocumentClient({apiVersion: '2012-08-10'});

function getBaseResponse(res) {
  return {status: res.statusCode}
}

// --- Login Services --- //
app.get('/login/cognito_id', function(req, res) {
  console.log(req.query);
  var response = getBaseResponse(res);
  var params = {
    TableName: AwsTablesEnum.USER_PROFILES,
    IndexName: 'cognitoId-index',
    KeyConditionExpression: 'cognitoId = :hkey',
    ExpressionAttributeValues: {
      ':hkey' : req.query.cognitoId
    }
  };

  docClient.query(params, function(err, data) {
    if (err) {
      console.log("Error querying DDB: ", err);
      response.status = err.statusCode;
      res.send(JSON.stringify(response));
      res.end();
    } else {
      userProfileCallback(data, response, res);
    }
  });
});

app.get('/login/username', function(req, res) {
  var response = getBaseResponse(res);
  var params = {
    TableName: AwsTablesEnum.USER_PROFILES,
    Key: {
      username: req.query.username
    }
  };

  docClient.get(params, function(err, data) {
    if (err) {
      console.log("Error reading DDB: ", err);
      response.status = err.statusCode;
      res.send(JSON.stringify(response));
      res.end();
    } else {
      userProfileCallback(data, response, res);
    }
  });
});

app.get('/login/player_profile', function(req, res) {
  var response = getBaseResponse(res);
  console.log("firstname = " + req.query.firstname);
  console.log("lastname = " + req.query.lastname);
  params = {
    TableName: AwsTablesEnum.PLAYER_PROFILES,
    IndexName: 'FirstName-LastName-index',
    KeyConditionExpression: 'FirstName = :key1 and LastName = :key2',
    ExpressionAttributeValues: {
      ':key1' : req.query.firstname,
      ':key2' : req.query.lastname
    }
  };

  docClient.query(params, function(err, data) {
    if (err) {
      console.log("Error querying DDB: ", err);
      response.status = err.statusCode;
      res.send(JSON.stringify(response));
      res.end();
    } else {
      if (data.Count == 1) {
        var playerProfile = data.Items[0];
        response.playerProfile = playerProfile;
        console.log(playerProfile);
        if (playerProfile.HasUserProfile) {
          params = {
            TableName: AwsTablesEnum.USER_PROFILES,
            Key: {
              username: playerProfile.Username
            }
          };
          docClient.get(params, function(err, data) {
            if (err) {
              console.log("Error reading DDB: ", err);
              response.status = err.statusCode;
            } else {
              console.log(data);
              response.userProfile = data.Item;
            }
            res.send(JSON.stringify(response));
            res.end();  
          });
        }
      }
    }
  });
});

var userProfileCallback = function(data, response, res) {
  if (data.Count == 1) {
    var userProfile = data.Items[0];
    response.userProfile = userProfile;
    if (userProfile.IsVarsityPlayer) {
      params = {
        TableName: AwsTablesEnum.PLAYER_PROFILES,
        KeyConditionExpression: 'Team = :key1 and Index = :key2',
        ExpressionAttributeValues: {
          ':key1' : userProfile.PlayerTeam,
          ':key2' : userProfile.PlayerIndex
        }
      };

      docClient.query(params, function(err, data) {
        if (err) {
          console.log("Error querying DBB: ", err);
          response.status = err.statusCode;
        } else {
          varsityProfileCallback(data, response, res);
        }
      });
    } else {
      response.playerProfile = null;
      res.send(JSON.stringify(response));
      res.end();
    }
  } else {
    response.userProfile = null;
    response.playerProfile = null;
    res.send(JSON.stringify(response));
    res.end();
  }
};

var varsityProfileCallback = function(data, response, res) {
  var playerProfile;
  if (data.Count == 1) {
    playerProfile = data.Items[0];
    response.playerProfile = playerProfile;
  }
  res.send(JSON.stringify(response));
  res.end();
};

app.get('/login/verify_username', function(req, res) {
  var response = getBaseResponse(res);
  response.isUniqueUsername = doesUserExists(req.query.username);
  res.end(JSON.stringify(response));
});

function doesUserExists(username) {
  var params = {
    TableName: AwsTablesEnum.USER_PROFILES,
    Key: {
      username: username
    }
  };
  docClient.get(params, function(err, data) {
    if (err) {
      console.log("Error reading DDB: ", err);
      return false;
    } else {
      return !isEmpty(data);
    }
  });
  return false;
}

app.post('/login/new_user', function(req, res) {
  var userProfile = req.body;
  var response = getBaseResponse(res);

  console.log(userProfile);

  var now = new Date();
  var params = {
    TableName: AwsTablesEnum.USER_PROFILES,
    Item: {
      'username': userProfile.username,
      'cognitoId': userProfile.cognitoId,
      'fcmInstanceId': userProfile.fcmInstanceId,
      'facebookId': userProfile.facebookId,
      'facebookLink': userProfile.facebookLink,
      'email': userProfile.email,
      'firstname': userProfile.firstname,
      'lastname': userProfile.lastname,
      'gender': userProfile.gender,
      'birthday': userProfile.birthday,
      'school': userProfile.school,
      'notificationsPref': {
        notifyDirectFistbump: true,
        notifyPostFistbump: true,
        notifyCommentFistbump: true,
        notifyNewComment: true,
        notifyDirectMessage: true
      },
      'isNewUser': true,
      'hasNewMessage': false,
      'hasNewNotification': false,
      'dateJoinedUtc': now.toUTCString(),
      'dateLastLoggedInUtc': now.toUTCString(),
      'lastLoggedInTimestampInMs': Math.round(Date.now()/1000)
    } 
  };

  docClient.put(params, function(err, data) {
    if (err) {
      console.log("Error writing to DBB: " + err);
      response.status = err.statusCode;
    }
    res.end(JSON.stringify(response));
  });
});

// --- Post Service --- //

app.post('/post/like', function(req, res) {
  console.log(req.query);
  var response = getBaseResponse(res);
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
  // Send the request to Google firebase
  request(options, function (error, res, body) {
    response.status = res.statusCode;
    if (error) {
      console.log("ERROR: " + error);
    }
    else if (res.statusCode == 200) {
        createNewNotification(req.query);
    }
  });

  res.end(JSON.stringify(response));
});

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

app.post('/post/new_post', function(req, res) {
  var response = savePost(req.query.username, 
                          req.query.username,
                          req.query.post_id,
                          req.query.cognito_id,
                          req.query.facebook_id,
                          req.query.first_name,
                          req.query.text_content,
                          req.query.timestampSeconds,
                          0,
                          0);

  res.end(JSON.stringify(response));
});

function savePost(username, 
                  postId, 
                  cognitoId, 
                  facebookId, 
                  firstname, 
                  textContent, 
                  timestampSeconds, 
                  commentsCount, 
                  fistbumpCount) {
  var response = getBaseResponse;
  var params = {
    TableName: AwsTablesEnum.USER_POSTS,
    Item: {
      'Username': username,
      'PostId': postId,
      'CognitoId': cognitoId,
      'FacebookId': facebookId,
      'Firstname': firstname,
      'TextContent': textContent,
      'TimestampSeconds': timestampSeconds,
      'CommentsCount': commentsCount,
      'FistbumpsCount': fistbumpCount
    }
  };

  docClient.put(params, function(err, data) {
    if (err) {
      console.log("Error writing to DBB: " + err);
      response.status = err.statusCode;
    }
    return response;
  });
};

app.get('/post/user_post', function(req, res) {
  var response = getBaseResponse(res);

  console.log(req.query);
  var params = {
    TableName: AwsTablesEnum.USER_POSTS,
    Key: {
      Username: req.query.username,
      TimestampSeconds: parseInt(req.query.timestampSeconds)
    }
  };

  docClient.get(params, function(err, data) {
    if (err) {
      console.log("Error reading DBB: " + err);
      response.status = err.statusCode;
    } else {
      var post = data.Item;
      var comments = JSON.parse(post.CommentsJson);
      // verify all comments are still from existing users
      for (var i = comments.length - 1; i >= 0; i--) {
        var commentsUpdated = new Array();
        if (doesUserExists(comments[i].comment_username)) {
          commentsUpdated.push(comments[i]);
        }
      }
      post.CommentsJson = JSON.stringify(commentsUpdated);
      response.post = post;
    }
    res.end(JSON.stringify(response));
  });
});

app.get('post/update_post', function(req, res) {
  var response = getBaseResponse(res);

  console.log(req.query);

  var post = req.query;

  var params = {
    TableName: AwsTablesEnum.USER_POSTS,
    Key: {
      Username: post.username,
      TimestampSeconds: post.timestampSeconds
    }
  };

  docClient.delete(params, function(err, data) {
    if (err) {
      console.log("Error deleting post from DBB: " + err);
      response.status = err.statusCode;
    } else {
      response = savePost(post.username, 
                          post.postId, 
                          post.cognitoId, 
                          post.facebookId, 
                          post.firstname, 
                          post.textContent, 
                          post.timestampSeconds, 
                          post.commentsCount, 
                          post.fistbumpCount);
    }
    res.end(JSON.stringify(response));
  });
});

app.get('/post/feed', function(req, res) {
  var response = getBaseResponse(res);
  var params = {
    TableName: AwsTablesEnum.USER_POSTS
  }

  docClient.scan(params, function(err, data) {
    if (err) {
      console.log("Error scanning DBB: " + err);
      response.status = err.statusCode;
    } else {
      response.posts = data.Items;
    }
    res.send(JSON.stringify(response));
    res.end();
  });
});

// --- Notification Service --- //

var NotificationTypes = {
  DIRECT_FISTBUMP: 0,
  DIRECT_MESSAGE: 1,
  POST_COMMENT: 2,
  POST_FISTBUMP: 3,
  COMMENT_FISTBUMP: 4,
  DIRECT_FISTBUMP_MATCH: 5
}

app.get('/notification/new_notification', function(req, res) { 
  var response = getBaseResponse(res);
  var params = {
    TableName: AwsTablesEnum.USER_PROFILES,
    Key: {
      username: req.query.username
    }
  };
  docClient.get(params, function(err, data) {
    if (err) {
      console.log("Error reading from DDB: ", err);
      response.status = err.statusCode;
    } else {
      var userProfile = data.Item;
      response.hasNewNotification = userProfile.hasNewNotification;
      response.hasNewMessage = userProfile.hasNewMessage;
    }
    res.send(JSON.stringify(response));
    res.end();  
  });
});

app.get('/notification/create_comment_fistbump_notification', function(req, res) {
  var response = getBaseResponse(res);
  var comment = req.query.comment;

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

/////////////////////
// Utility Methods //
/////////////////////
function isEmpty(obj) {
  return Object.keys(obj).length == 0;
}

