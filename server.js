/*
Author: Kirsten Corrao
Date: 5/30/2020
Final Project
Sources:
GAE Documentation for node.js
Nunjucks templates: https://mozilla.github.io/nunjucks/getting-started.html
HTML input types: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input
people API discovery docs: https://developers.google.com/people/api/rest
main source - google API library - oauth: https://github.com/googleapis/google-api-nodejs-client/#authentication-and-authorization
authentication with id_token: https://developers.google.com/identity/sign-in/web/backend-auth
slice to remove part of string: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice
*/

// set up necessary libraries
const express = require('express');
const bodyParser = require('body-parser');
const fs = require("fs");
const nunjucks = require('nunjucks');
const request = require("request-promise");
const {Datastore} = require('@google-cloud/datastore');
const {google} = require('googleapis');

const app = express();
app.use('/public', express.static('public'))
app.use(bodyParser.json());

nunjucks.configure('views', { 
  autoescape: true,
  express: app
 });

const datastore = new Datastore();

// url to add all other routes to
const URL = "http://localhost:8001/";
//const URL = "https://hw7b-493-corraok.wl.r.appspot.com/";


/*** error codes ***/ 
// error when request's body is missing an attribute
const attributeMissingError = {
  "code": 400,
  "data": {
    "error": "The requested object is missing at least one of the required attributes"
  }
};

// error if ID token is not valid and user can't be authenticated
const userNotAuthenticatedError = {
  "code": 401,
  "data": {
    "error": "The user cannot be authenticated."
  }
}

// error when authenticated user tries to delete boat that doesn't exist 
const userDoesNotOwnBoatError = {
  "code": 403,
  "data": {
    "error": "The authenticated user owns no boat with that boat ID."
  }
};


/*** datastore entities***/

// name is datastore entity name; URL can be use to build entity's URL  
const BOAT = {
  "name": "Boat",
  "URL": "boats/",
  "attributes": ["name", "type", "length"]
};


/*** OAuth ***/
// file with client ID and secret
const oauthFile = JSON.parse(fs.readFileSync("oauth/client_secret.json", 'utf8'));
const CLIENT_ID = oauthFile.web.client_id;
const CLIENT_SECRET = oauthFile.web.client_secret;
const REDIRECT_URL = oauthFile.web.redirect_uris[0];

// create oauth client with credentials in file
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URL
);

// user will grant access to profile info
const oauthURL = oauth2Client.generateAuthUrl({
  access_type: 'online',
  scope: 'https://www.googleapis.com/auth/userinfo.profile'
});

// verifies if the user is authenticated through google 
// input: IdToken of user
// output: returns object of user info if authenticated; otherwise returns false
async function verifyUser(idToken) {
  if (idToken === undefined || idToken === '') {
    return false;
  }

  // remove 'Bearer' from beginning of token that Postman adds
  if (idToken.slice(0, 7) === 'Bearer ') {
    idToken = idToken.slice(7);
  }

  const ticket = await oauth2Client.verifyIdToken({
    idToken: idToken,
    audience: CLIENT_ID
  }).catch(error => {
    console.log("error authenticating user", error);
    return false;
  });

  return ticket;      // returns false if user not authenticated; otherwise contains user info
}



/*** helper functions ***/
// returns true if ANY boat attribute (name, type, or length) is missing from the request's body 
function anyBoatAttributeIsMissing(body) {
  return body.name === undefined || body.type === undefined || body.length === undefined;
}

// builds and returns self URL for an entity (ex: http://mysite.com/boats/12345)
// input: ID of entity; type of entity (e.g. BOAT)
// output: self URL for entity
function makeSelfURL(id, type) {
  return URL + type.URL + id;
}

// returns an entity from datastore
// input: entity's ID and type (e.g. BOAT)
// output: entity, which contains its key and all properties
async function getEntityFromDatastore(id, type) {
  const key = datastore.key([type.name, parseInt(id)]);
  const [entity] = await datastore.get(key).catch(error => console.log(error));
  return entity;
}

// returns a boat's information in JSON
// input: boatEntity from datastore 
// output: object containing ID, properties, and self URL
function makeBoatFormatJSON(boatEntity) {
  return {
    "name": boatEntity.name,
    "type": boatEntity.type,
    "length": boatEntity.length,
    "owner": boatEntity.owner,
    "id": boatEntity[Datastore.KEY].id,
    "self": makeSelfURL(boatEntity[Datastore.KEY].id, BOAT)
  }
}

// returns a formatted array of entitites according to its type 
// input: type (e.g. BOAT); array of entities from datastore 
// output: array of information formatted in JSON, which includes IDs, properties, and self URLs for each entity
async function makeResponseByType(type, entities) {
  let response = {};

  if (type.name == "Boat") {
    response = Promise.all(
      entities.map( async (boat) => {
        return makeBoatFormatJSON(boat);
      })
    );
  }

  return response;
}

// get all items of a particular type (e.g. BOAT); no user authentication is needed or checked
// input: type of item
// output: code 200 and array of JSON items of that type
async function getItemsByType(type) {
  // all responses get code 200; data will hold items, self URL, and next URL if needed
  const response = {
    "code": 200,
    "data": {}
  }
  // get all items of that type, with certain number per page 
  let query = datastore.createQuery(type.name);

  // get results, where index 0 is items and index 1 is metadata about query for pagination
  const results = await datastore.runQuery(query)
    .catch(error => {
      console.log("error getting all boats from datastore", error);
      return {
        "code": 400,
        "data": {}
      }
    });

  // if results from database, format each in JSON
  if (results) {
    const items = results[0]; 
    response.data.items = await makeResponseByType(type, items).catch(error => console.log(error));
  }
  
  return response;
}


/*** route functions ***/

// post new boat 
// input: name and type (strings); length (int)
// output on success: returns code 201 and formatted boat data if successful (name, type, length, ID, and self URL)
// error: 400 if name, type, or length are missing; 401 if user can't be authenticated by ID token
async function postBoat(idToken, body){
  // check for errors (see above)
  if (anyBoatAttributeIsMissing(body)) { 
    return attributeMissingError;
  }

  const userData = await verifyUser(idToken)
    .catch( error => {
      console.log("error authenticating user", error);
      return userNotAuthenticatedError;
    });

  if (userData === false) {
    return userNotAuthenticatedError;
  }

  // no errors: create the boat, add to datastore, and return code and data
  const key = datastore.key(BOAT.name);
  const newBoat = {
    "name": body.name,
    "type": body.type,
    "length": body.length,
    "owner": userData.payload.sub
  };

  // save new boat to datastore 
  await datastore.save({ "key": key, "data": newBoat }).catch(error => console.log("error saving to datastore: ", error));

  // response also needs boat ID and self URL
  newBoat.id = key.id;
  newBoat.self = makeSelfURL(key.id, BOAT);

  // success: code 201 and new boat data
  return {
    "code": 201,
    "data": newBoat
  }
}

// gets all boats that belong to a particular owner
// input: user id token passed in authorization header
// output on success: returns code 200 and array of boats belonging to that owner, each JSON formatted
// errors: 401 if owner's ID is missing or invalid
async function getOwnersBoats(idToken) {
  // authenticate owner by token
  const userData = await verifyUser(idToken)
    .catch( error => {
      console.log("error authenticating user", error);
      return userNotAuthenticatedError;
    });

  if (userData === false) {
    return userNotAuthenticatedError;
  }

  // get array of boats with
  const query = datastore.createQuery('Boat').filter('owner', '=', userData.payload.sub);
  const [boats] = await datastore.runQuery(query).catch(error => console.log(error));
  const boatsJSON = boats.map(makeBoatFormatJSON);

  return {
    "code": 200,
    "data": {
      "boats": boatsJSON
    }
  }
}

// delete an existing boat, if the user is authenticated and owns the boat; otherwise returns error code 403
// input: boatID to delete
// output on success: code 204 after boat is deleted
// output on error: code 403 if user doesn't own boat or boat doesn't exist
async function deleteBoat(idToken, boatID) {
  // error if can't authenticate user
  const userData = await verifyUser(idToken).catch( error => console.log("error authenticating user", error));

  if (!userData || userData === false) {
    return userNotAuthenticatedError;
  }

  // get boat with that ID from datastore
  const boatEntity = await getEntityFromDatastore(boatID, BOAT).catch(error => console.log(error));

  // if boat doesn't exist or authenticated user doesn't own it, return error
  if (!boatEntity || (boatEntity.owner !== userData.payload.sub)) {
    return userDoesNotOwnBoatError;
  } 

  // delete boat
  const key = boatEntity[Datastore.KEY];
  await datastore.delete(key).catch(error => console.log(error));

  return {
    "code": 204,
    "data": {}
  }
}


// *** routes *** 

// welcome page: sends authentication request to google
app.get('/', async(req, res) => {
  let data = {
    "oauthURL": oauthURL
  };

  res.render("index.html", data);
});


// returns user data from the Google People API 
// input: tokens object from google that contains the access token 
// output: if successful, returns JSON containing user's name and other info; otherwise prints error to console and returns empty object
async function getUserData(token) {
  // send get request to get user's information in People API
  const getRequest = {
    url: "https://people.googleapis.com/v1/people/me/?personFields=names&access_token=" + token.access_token,
    method: "GET"
  }

  const result = await request(getRequest)
    .catch( error => {
      console.log("error getting user data from people API", error);
      return {};
    });

  // return JSON of user data
  return JSON.parse(result);
}

// display user info
app.get('/user', async(req, res) => {
  // error if no query parameters sent by google --> access denied
  if (req.query.error) {
    res.render('user.html', {"error": "Access Denied"});
  } 

  // get token for this user to authenticate them
  const code = req.query.code;
  const {tokens} = await oauth2Client.getToken(code).catch(error => console.log(error));

  oauth2Client.setCredentials(tokens);

  // get user data from people API
  const userData = await getUserData(tokens).catch(error => console.log(error));

  // format data and send
  const responseData = {
    firstName: userData.names[0].givenName,
    lastName: userData.names[0].familyName,
    idToken: tokens.id_token,
  }

  res.render("user.html", responseData);
});

// returns array of all boats in JSON, no authentication required
app.get('/boats', async function(req, res){
  const result = await getItemsByType(BOAT);
  res.status(result.code).send(result.data);
});

// creates new boat if all data is provided in body; request and response must be JSON; otherwise error message
app.post('/boats', async(req, res) => {
  const result = await postBoat(req.headers.authorization, req.body).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// returns information about an owner's boats
app.get('/owners/:ownerID/boats', async(req, res) => {
  const result = await getOwnersBoats(req.headers.authorization).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// deletes a boat from datastore if the authenticated user owns it
app.delete("/boats/:boatID", async(req, res) => {
  const result = await deleteBoat(req.headers.authorization, req.params.boatID).catch(error => console.log(error));
  res.status(result.code).send(result.data);
});

// listen to GAE port if it exists; 8001 otherwise
const PORT = process.env.PORT || 8001;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});
