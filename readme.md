# Trails REST API

This API tracks Trails, Trailheads, and Users. Users are authenticated using OAuth 2.0 and Google's People API. Trails can be related to multiple trailheads, and trailheads can be related to multiple trails. Each trail belongs to one user. Users can create, view, modify, and delete only trails that belong to them. Trailheads can be viewed, modified, or deleted by any user. All data is stored in Google's Datastore, a NoSQL database.


### Datastore Entities

* Trails
    * Required attributes 
        * name: string
        * length: float
        * difficulty: string (easy, medium, or hard)
    * Other attributes 
        * trailheads: array of strings; empty when Trail is created
        * id: int; automatically generated
        * userId: int; automatically added; ID of user who created trail in database
    * Authentication required: yes

* Trailheads
    * Required attributes
        * name: string
    * Optional attributes
        * location: geographical point
            * Example: {'latitude': 46.243232, 'longitude': -117.689337}
        * fee: float
        * trails: array of strings
    * Other attributes 
        * id: int; automatically generated
    * Authentication required: no

* Users
    * Required attributes
        * firstName (string)
        * lastName (string)
    * Other attributes 
        * id: int; automatically generated
        * userId: int; automatically generated from JWT sub value; used to verify owner of Trails
    * Authentication required: NA


### Endpoints

#### Authentication
GET /
* Allows users to authenticated themselves with Google and retrieve their JWT sub value, which is used to authenticated users in this API

#### Trails

GET /trails
* Gets all trails that belong to the authenticated user. Returns empty list if user has no trails.
* Authentication required
* Reponse
    * 200: OK
    * 401: user can't be authenticated
    * 406: accept header doesn't allow JSON

GET /trails/:trail_id
* Gets specified trail, if it belongs to the authenticated user
* Authentication required
* Required parameters 
    * ID of trail
* Reponse
    * 200: OK
    * 401: user can't be authenticated
    * 403: trail doesn't exist or doesn't belong to this user
    * 406: accept header doesn't allow JSON

POST /trails
* Creates new trail belonging to the authenticated user
* Authentication required
* Required parameters 
    * name
    * length
    * difficulty
* Response: JSON
    * 201: created
    * 400: request was missing a required attribute
    * 401: user can't be authenticated
    * 406: accept header doesn't allow JSON

PATCH /trails/:trail_id
* Edits some or all properties of specified trail, if it belongs to the authenticated user
* Authentication required
* Required parameters 
    * ID of trail
* Optional parameters 
    * name
    * length
    * difficulty
* Reponse
    * 204: no content (successfully updated)
    * 401: user can't be authenticated
    * 403: trail doesn't exist or doesn't belong to this user
    * 406: accept header doesn't allow JSON

PUT /trails/:trail_id
* Edits all properties of specified trail, if it belongs to the authenticated user
* Authentication required
* Required parameters 
    * ID of trail
    * name
    * length
    * difficulty

* Reponse
    * 204: no content (successfully updated)
    * 400: request was missing a required attribute 
    * 401: user can't be authenticated
    * 403: trail doesn't exist or doesn't belong to this user
    * 406: accept header doesn't allow JSON

DELETE /trails/:trail_id
* Deletes the specified trail, if it belongs to the authenticated user
* Authentication required
* Required parameters 
    * ID of trail
* Reponse
    * 204: no content (successfully deleted)
    * 401: user can't be authenticated
    * 403: trail doesn't exist or doesn't belong to this user
    * 406: accept header doesn't allow JSON

#### Trailheads

GET /trailheads
* Gets all trailheads. Returns empty list if none exist.
* Reponse
    * 200: OK
    * 406: accept header doesn't allow JSON

GET /trailheads/:trailhead_id
* Gets specified trailhead
* Required parameters 
    * ID of trail
* Reponse
    * 200: OK
    * 404: trailhead doesn't exist
    * 406: accept header doesn't allow JSON

POST /trailheads
* Creates new trailhead
* Required parameters 
    * name
    * location
    * fee
* Response: JSON
    * 201: created
    * 400: request was missing a required attribute
    * 406: accept header doesn't allow JSON

PATCH /trailheads/:trailhead_id
* Edits some or all properties of specified trailhead
* Required parameters 
    * ID of trailhead
* Optional parameters 
    * name
    * location
    * fee
* Reponse
    * 204: no content (successfully updated)
    * 404: trailhead doesn't exist
    * 406: accept header doesn't allow JSON

PUT /trailheads/:trailhead_id
* Edits all properties of specified trailhead
* Required parameters 
    * ID of trailhead
    * name
    * location
    * fee

* Reponse
    * 204: no content (successfully updated)
    * 404: trailhead doesn't exist
    * 406: accept header doesn't allow JSON

DELETE /trailheads/:trailhead_id
* Deletes the specified trailhead
* Required parameters 
    * ID of trailhead
* Reponse
    * 204: no content (successfully deleted)
    * 404: trailhead doesn't exist
    * 406: accept header doesn't allow JSON

#### Trails <-> Trailheads
PUT /trails/:trail_id/trailhead/:trailhead_id
* Assigns a trailhead to a trail, if the trail belongs to the authenticated user
* Authentication required
* Required parameters 
    * ID of trail
    * ID of trailhead
* Reponse
    * 204: no content (successfully assigned trailhead)
    * 401: user can't be authenticated
    * 403: trail doesn't exist or doesn't belong to this user
    * 404: trailhead doesn't exist
    * 406: accept header doesn't allow JSON

DELETE /trails/:trail_id/trailhead/:trailhead_id
* Un-assigns a trailhead from a trail, if the trail belongs to the authenticated user
* Authentication required
* Required parameters 
    * ID of trail
    * ID of trailhead
* Reponse
    * 204: no content (successfully un-assigned trailhead)
    * 401: user can't be authenticated
    * 403: trail doesn't exist or doesn't belong to this user
    * 404: trailhead doesn't exist
    * 406: accept header doesn't allow JSON


### Postman Tests
* Test suite contained in trails-api.postman_collection.json
* Must use environment file, trails-api.postman_environment.json
    * Authenticate two users at https://trails-api.wl.r.appspot.com
        * Copy 1st user's JWT and User ID to jwt1 and user_id1
        * Copy 2nd user's JWT and User ID to jwt2 and user_id2
    * Authenticate a user at https://trails-api.wl.r.appspot.com
        * Copy their JWT to jwt1 in the environment file
        * Copy their User ID to user_id1 in the environment file
        
