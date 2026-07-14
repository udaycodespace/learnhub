const nodemailer = require("nodemailer");

const sendEmail = async ({ to, subject, text, html }) => {
  const isPlaceholder = !process.env.EMAIL_USER || 
                        process.env.EMAIL_USER.includes("your_email") || 
                        !process.env.EMAIL_PASS || 
                        process.env.EMAIL_PASS.includes("your_app_password");

  if (isPlaceholder) {
    console.log(`\n[EMAIL FALLBACK LOGGER]\n-----------------------------------------\nTo: ${to}\nSubject: ${subject}\nContent: ${text}\n-----------------------------------------\n`);
    return { success: true, logged: true };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || "smtp.gmail.com",
      port: parseInt(process.env.EMAIL_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      text,
      html,
    };

    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error("Email send failed, falling back to console log. Error:", error.message);
    console.log(`\n[EMAIL FALLBACK LOGGER]\n-----------------------------------------\nTo: ${to}\nSubject: ${subject}\nContent: ${text}\n-----------------------------------------\n`);
    return { success: false, error: error.message };
  }
};

module.exports = sendEmail;
