const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Serialize user ID into session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user object from session ID
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    if (!user) return done(null, false);
    done(null, {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      avatar: user.avatar,
      googleId: user.googleId,
    });
  } catch (err) {
    done(err, null);
  }
});

// Passport Local Strategy for Admin Login
passport.use(
  'admin-local',
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
        if (!user) {
          return done(null, false, { message: 'Invalid admin credentials.' });
        }

        if (!user.password) {
          return done(null, false, { message: 'This account uses Google Login.' });
        }

        const isMatch = bcrypt.compareSync(password, user.password);
        if (!isMatch) {
          return done(null, false, { message: 'Invalid admin credentials.' });
        }

        if (user.role !== 'admin') {
          return done(null, false, { message: 'Access denied: Admin role required.' });
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Passport Google Strategy for Standard User Login
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'MOCK_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'MOCK_GOOGLE_CLIENT_SECRET';
const CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback';

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : `${profile.id}@google.com`;
        let user = await User.findOne({ where: { googleId: profile.id } });

        if (!user) {
          user = await User.findOne({ where: { email } });
          if (user) {
            // Link googleId to existing user
            user.googleId = profile.id;
            if (!user.avatar && profile.photos && profile.photos[0]) {
              user.avatar = profile.photos[0].value;
            }
            await user.save();
          } else {
            // Create new Google User
            user = await User.create({
              googleId: profile.id,
              email,
              name: profile.displayName || profile.name?.givenName || 'Google User',
              avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
              role: 'user',
            });
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

module.exports = passport;
