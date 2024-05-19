const AWS = require('aws-sdk');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
const fs = require('fs');

// Configure AWS SDK to use LocalStack endpoint
AWS.config.update({
  endpoint: 'http://localhost:4566', // LocalStack endpoint for S3
  accessKeyId: 'test',
  secretAccessKey: 'test',
  region: 'us-east-1' // Modify the region as needed
});

// Create S3 client
const s3 = new AWS.S3();

// Create an Nodemailer transporter configured to use MailHog SMTP
const transporter = nodemailer.createTransport({
  host: 'host.docker.internal',
  port: 1025, // MailHog SMTP port
  secure: false,
  ignoreTLS: true
});

// Lambda function handler
exports.handler = async (event, context) => {
  try {
    // Array to store object details
    const objectDetails = [];

    // Process S3 event
    for (const record of event.Records) {
      // Extract relevant information from the S3 event
      const bucket = record.s3.bucket.name;
      const key = record.s3.object.key;
      const size = record.s3.object.size;

      // Get object type based on file extension
      const objectType = key.split('.').pop().toUpperCase();

      // Save object details
      objectDetails.push({ key, objectType, size });

      // If the uploaded object is an image, generate and save a thumbnail
      if (objectType === 'JPG' || objectType === 'JPEG' || objectType === 'PNG' || objectType === 'GIF') {
        await generateAndSaveThumbnail(bucket, key);
      }
    }

    // Save object details to a file
    const summaryFilePath = '/tmp/objects_summary.txt';
    fs.writeFileSync(summaryFilePath, formatObjectDetails(objectDetails));

    // Send email with summary of uploaded objects at the end of the day
    const today = new Date();
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    const remainingTimeMs = endOfDay.getTime() - Date.now();

    setTimeout(async () => {
      const emailSubject = 'S3 bucket notification Email';
      const emailBody = fs.readFileSync(summaryFilePath, 'utf-8');
      await sendEmail(emailSubject, emailBody);
    }, remainingTimeMs);

    return {
      statusCode: 200,
      body: JSON.stringify('S3 events processed successfully')
    };
  } catch (error) {
    console.error('Error processing S3 events:', error);
    return {
      statusCode: 500,
      body: JSON.stringify('Error processing S3 events')
    };
  }
};

// Function to generate and save thumbnail for image file
async function generateAndSaveThumbnail(bucket, key) {
  const image = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  const thumbnail = await sharp(image.Body).resize({ width: 100, height: 100 }).toBuffer();

  await s3.putObject({
    Bucket: bucket,
    Key: `thumbnails/${key}`, // Save thumbnail with a prefix
    Body: thumbnail,
    ContentType: 'image/jpeg' // Set appropriate content type
  }).promise();
}

// Function to format object details for email body
function formatObjectDetails(objectDetails) {
  let summary = 'Object Key\tObject Type\tObject Size (bytes)\n';
  for (const detail of objectDetails) {
    summary += `${detail.key}\t${detail.objectType}\t${detail.size}\n`;
  }
  return summary;
}

// Function to send email using MailHog SMTP
async function sendEmail(subject, body) {
  const mailOptions = {
    from: 'sender@example.com',
    to: 'recipient@example.com', // Add recipient email address(es) here
    subject: subject,
    text: body
  };

  await transporter.sendMail(mailOptions);
}
