import AWS from 'aws-sdk';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import { Storage } from '@google-cloud/storage';
const key = JSON.parse(process.env.GCP_APP_CREDENTIALS)
const gcsBucketName = process.env.GCP_BUCKET
const project_id = process.env.PROJECT_ID
const user_id = process.env.USER_ID
const password = process.env.PASSWORD
const dynamoDBTable = process.env.DYNAMODB_TABLE
const storage = new Storage({
  projectId: project_id,
  credentials: key,
});
const transporter = nodemailer.createTransport({
  host: 'smtp.mailgun.org',
  port: 587,
  secure: false,
  auth: {
    user: user_id,
    pass: password,
  },
});

const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB.DocumentClient();

export const handler = async (event, context) => {
  try {
    // Extract necessary information from SNS event
    const snsMessage = JSON.parse(event.Records[0].Sns.Message);
    console.log(snsMessage)
    const { user_email, submission_url } = JSON.parse(JSON.stringify(snsMessage));

    // Download release from GitHub
    const releaseResponse = await fetch(submission_url);
    const releaseDataArrayBuffer = await releaseResponse.arrayBuffer();
    const releaseData = Buffer.from(releaseDataArrayBuffer);
    const gcsFileName = `${user_email}/release.zip`;
    await storage.bucket(gcsBucketName).file(gcsFileName).save(releaseData);

    // Email the user about the status of the download
    await sendEmail(user_email, 'Download Status', 'Release downloaded successfully.');

    // Track the email in DynamoDB
    await trackEmail(user_email, 'Download Status', new Date().toISOString(), submission_url);

    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

export async function sendEmail(from, to, subject, message) {
  const mailOptions = {
    from: user_id,
    to: to,
    subject: subject,
    text: message,
  };
  const result = await transporter.sendMail(mailOptions);
  console.log(result);
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Email sent successfully' }),
  };
}

export async function trackEmail(user_email, subject, timestamp, submission_url) {
  const params = {
    TableName: dynamoDBTable,
    Item: {
      user_email: user_email,
      subject: subject,
      timestamp: timestamp,
      submission_url: submission_url
    },
  };

  await dynamoDB.put(params).promise();
}


