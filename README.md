# dod-distribute-donations

DoD picks up the message and fetches initial state and the package weight maps:
* org_donation_state/${correlationId}/${language}_${registry}_package_weight_map.json for each supported lang/reg
* org_donation_state/${correlationId}/initialState.json

DoD parses out the organization ID, amount, timestamp, and package weight maps from the JSON files. It applies the donation to the weight map and updates Mongo packages accordingly. It writes a snapshot to the org in Mongo with timestamp and TLP count.

The correlationId folder is deleted from S3.