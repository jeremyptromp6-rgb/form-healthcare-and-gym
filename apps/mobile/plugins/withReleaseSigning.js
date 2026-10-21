// Expo config plugin: signs the Android release build with the upload key when it is supplied.
//
// The Play Store release workflow (.github/workflows/android-release.yml) passes the keystore as
// Gradle project properties (ORG_GRADLE_PROJECT_* environment variables, never on a command line):
//   FORM_UPLOAD_STORE_FILE, FORM_UPLOAD_STORE_PASSWORD, FORM_UPLOAD_KEY_ALIAS, FORM_UPLOAD_KEY_PASSWORD
//   and optionally FORM_UPLOAD_STORE_TYPE (pkcs12 or jks; otherwise taken from the file extension).
// With none of them set (the test-APK workflow, local builds) nothing changes and the template's
// debug signing stays in place. With only some of them set the build fails rather than shipping a
// build signed with the wrong key.
//
// The block is appended to the generated app/build.gradle as a second `android {}` section, so it
// does not depend on the exact text of Expo's template.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// FORM release signing (withReleaseSigning plugin)';

const BLOCK = `
${MARKER}
def formStoreFile = project.findProperty('FORM_UPLOAD_STORE_FILE')
def formSigningProps = ['FORM_UPLOAD_STORE_FILE', 'FORM_UPLOAD_STORE_PASSWORD', 'FORM_UPLOAD_KEY_ALIAS', 'FORM_UPLOAD_KEY_PASSWORD']
def formSigningSet = formSigningProps.findAll { project.hasProperty(it) }
if (formSigningSet.size() > 0 && formSigningSet.size() < formSigningProps.size()) {
    throw new GradleException('Release signing is partly configured. Set all of: ' + formSigningProps.join(', '))
}
if (formStoreFile) {
    def formStoreType = project.findProperty('FORM_UPLOAD_STORE_TYPE')
    if (!formStoreType) {
        formStoreType = (formStoreFile.toString().toLowerCase().endsWith('.jks') || formStoreFile.toString().toLowerCase().endsWith('.keystore')) ? 'jks' : 'pkcs12'
    }
    android {
        signingConfigs {
            release {
                storeFile file(formStoreFile)
                storeType formStoreType
                storePassword project.property('FORM_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('FORM_UPLOAD_KEY_ALIAS')
                keyPassword project.property('FORM_UPLOAD_KEY_PASSWORD')
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.release
            }
        }
    }
}
`;

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: expected a Groovy app/build.gradle');
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(/\s*$/, '\n') + BLOCK;
    }
    return cfg;
  });

module.exports = withReleaseSigning;
