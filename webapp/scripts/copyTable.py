import boto3, json
from decimal import *
from teamParsers import *

from botocore.compat import six

def createTable():
    table = dynamodb.create_table(
        TableName='user_profiles',
        KeySchema=[
            {
                'AttributeName': 'username',
                'KeyType': 'HASH'   #Partition key
            }
        ],
        AttributeDefinitions=[
            {
                'AttributeName': 'username',
                'AttributeType': 'S'
            }
        ],
        ProvisionedThroughput={
            'ReadCapacityUnits': 1,
            'WriteCapacityUnits': 1
        }
    )
    return table

dynamodb = boto3.resource('dynamodb', region_name='us-east-1', endpoint_url="https://dynamodb.us-east-1.amazonaws.com")

# table = createTable()
tableOld = dynamodb.Table("UserProfiles")
tableNew = dynamodb.Table("user_profiles")

response = tableOld.scan()

func = lambda s: s[:1].lower() + s[1:] if s else ''

for item in response['Items']:
    newItem = {}
    for key in item:
        newKey = func(key) if key != "FCMInstanceId" else "FCMInstanceId"
        newItem[newKey] = item[key]
    tableNew.put_item(Item=newItem)

while (tableNew.table_status != "ACTIVE"):
    pass

print("Table status:", tableNew.table_status)