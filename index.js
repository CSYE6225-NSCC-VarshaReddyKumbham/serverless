import AWS from 'aws-sdk';
import fetch from 'node-fetch';
import Mailgun from 'mailgun.js';
import FormData from 'form-data';
import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid'
const key = process.env.GCP_APP_CREDENTIALS
const gcsBucketName = process.env.GCP_BUCKET
const dynamoDBTable = process.env.DYNAMODB_TABLE
const keyBuffer = Buffer.from(key, 'base64');
const keyData = JSON.parse(keyBuffer.toString('utf-8'));

const storage = new Storage({
  credentials: keyData,
});
const mailgun = new Mailgun(FormData);
const mailgunApiKey = process.env.MAILGUN_API;
const mailgunDomain = process.env.MAILGUN_DOMAIN;
const mg = mailgun.client({ username: "api", key: mailgunApiKey });
const user_id = `varshareddykumbham@${mailgunDomain}`

const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

export const handler = async (event, context) => {
  try {
    // Extract necessary information from SNS event
    const snsMessage = JSON.parse(event.Records[0].Sns.Message);
    console.log(snsMessage)
    const { user_email, submission_url } = JSON.parse(JSON.stringify(snsMessage));

    // Download release from GitHub
    const result = await upload_zip_to_gcs(user_email, submission_url)
    
    // Email the user about the status of the download
    const status = await sendEmail(user_email, 'Assignment Download Status', result.msg);

    // Track the email in DynamoDB
    await trackEmail(user_email, 'Assignment Download Status', new Date().toISOString(), submission_url, status.body);

    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: `Internal Server Error: ${error}` };
  }
};

export async function upload_zip_to_gcs(user_email, submission_url) {
  try {
    const releaseResponse = await fetch(submission_url);
    if(!releaseResponse.ok){
      return { 
        statusCode: 400, 
        msg: `Unable to fetch the file. Please check your submission url and re-submit` 
      }
    }
    const releaseDataArrayBuffer = await releaseResponse.arrayBuffer();
    const releaseData = Buffer.from(releaseDataArrayBuffer);
    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, "");
    const gcsFileName = `${user_email}/release_${timestamp}.zip`;
    const result = await storage.bucket(gcsBucketName).file(gcsFileName).save(releaseData);
    return {
      statusCode: 200,
      msg: `Successfully uploaded the file to GCS Bucket: ${gcsBucketName}/${gcsFileName}`,
    };
  } catch (error) {
    console.error('Error:', error);
    return { 
      statusCode: 500, 
      msg: `Unable to upload the file due to following error: ${error}` };
  }
}

export async function sendEmail(to, subject, message) {
  try {
    await mg.messages.create(mailgunDomain, {
      from: user_id,
      to: [to],
      subject: subject,
      text: message,
    })
    return {
      statusCode: 200,
      body: 'Success',
    };
  }
    catch (error) {
      console.error('Error:', error);
      return { statusCode: 500, body: 'Failed' };
    }
}

export async function trackEmail(user_email, subject, timestamp, submission_url, status_msg) {
  try {
    const params = {
      TableName: dynamoDBTable,
      Item: {
        uuid: uuidv4(),
        user_email: user_email,
        subject: subject,
        timestamp: timestamp,
        submission_url: submission_url,
        email_status: status_msg,
      },
    };
    const result = await dynamoDB.put(params).promise();
    console.log(result)
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Updated email status in Dynamodb' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: `Internal Server Error: ${error}` };
  }
}


